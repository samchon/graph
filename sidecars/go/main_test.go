package main

import (
	"context"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/scip-code/scip/bindings/go/scip"
	"google.golang.org/protobuf/proto"
)

func TestBuildSnapshotProvesWorkspaceSemantics(t *testing.T) {
	root := copyFixture(t)
	indexer := fixtureScipIndexer{}
	environment := map[string]string{
		"GOVERSION":   "go1.25.0",
		"GOOS":        "fixture",
		"GOARCH":      "fixture",
		"CGO_ENABLED": "0",
		"GOFLAGS":     "",
		"GOWORK":      filepath.Join(root, "go.work"),
	}
	first, err := buildSnapshot(context.Background(), root, indexer, environment)
	if err != nil {
		t.Fatal(err)
	}
	second, err := buildSnapshot(context.Background(), root, indexer, environment)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(first, second) {
		t.Fatal("unchanged Go workspace did not reproduce one deterministic snapshot")
	}
	if first.ProjectRoot != root || !reflect.DeepEqual(first.Languages, []string{"go"}) {
		t.Fatalf("unexpected snapshot identity: %#v", first)
	}
	for _, name := range []string{
		"Greeter", "Box", "Base", "Service", "NewService", "Run", "TestRun",
	} {
		if findNode(first, name) == nil {
			t.Errorf("missing declaration %s", name)
		}
	}
	if findNode(first, "GhostFromExcludedBuildTag") != nil {
		t.Error("build-tag-excluded declaration entered the graph")
	}
	for _, kind := range []string{
		"contains", "exports", "imports", "calls", "accesses", "instantiates",
		"type_ref", "implements", "dispatches", "tests", "references",
	} {
		if countEdges(first, kind) == 0 {
			t.Errorf("fixture produced no %s edge", kind)
		}
	}
	service := findQualifiedNode(first, "example.com/impl.Service")
	greeter := findQualifiedNode(first, "example.com/api.Greeter")
	if service == nil || greeter == nil || !hasEdge(first, service.ID, greeter.ID, "implements") {
		t.Error("promoted Go method did not prove Service implements Greeter")
	}
	localResolve := findQualifiedNode(first, "example.com/impl.Resolve")
	apiResolve := findQualifiedNode(first, "example.com/api.Resolve")
	run := findQualifiedNode(first, "example.com/impl.Run")
	if localResolve == nil || apiResolve == nil || run == nil {
		t.Fatal("same-named resolution fixture is incomplete")
	}
	if !hasEdge(first, run.ID, localResolve.ID, "calls") || hasEdge(first, run.ID, apiResolve.ID, "calls") {
		t.Error("same-named function call crossed its package identity")
	}
	if len(first.Sources) == 0 || first.Tool.CompilerVersion != "go1.25.0" {
		t.Error("snapshot omitted source or toolchain evidence")
	}
	if len(first.Warnings) != 1 || !strings.Contains(first.Warnings[0], "unresolved") {
		t.Fatalf("dynamic call was not audited conservatively: %v", first.Warnings)
	}

	added := filepath.Join(root, "impl", "added.go")
	if err := os.WriteFile(added, []byte("package impl\nfunc Added() string { return Run() }\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	edited, err := buildSnapshot(context.Background(), root, indexer, environment)
	if err != nil {
		t.Fatal(err)
	}
	if edited.Universe == first.Universe || findNode(edited, "Added") == nil {
		t.Error("a created Go file did not replace the build universe and facts")
	}
	if err := os.Remove(added); err != nil {
		t.Fatal(err)
	}
	deleted, err := buildSnapshot(context.Background(), root, indexer, environment)
	if err != nil {
		t.Fatal(err)
	}
	if findNode(deleted, "Added") != nil {
		t.Error("a deleted Go file left a stale declaration")
	}
	moduleFile := filepath.Join(root, "impl", "go.mod")
	moduleBody, err := os.ReadFile(moduleFile)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(moduleFile, append(moduleBody, '\n'), 0o644); err != nil {
		t.Fatal(err)
	}
	configured, err := buildSnapshot(context.Background(), root, indexer, environment)
	if err != nil {
		t.Fatal(err)
	}
	if configured.Universe == deleted.Universe {
		t.Error("go.mod change did not move the build universe")
	}

	broken := filepath.Join(root, "impl", "broken.go")
	if err := os.WriteFile(broken, []byte("package impl\nfunc broken("), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := buildSnapshot(context.Background(), root, indexer, environment); err == nil {
		t.Error("an incomplete go/packages generation was published")
	}
}

func TestScipBoundaryRejectsForeignAndMalformedArtifacts(t *testing.T) {
	root := t.TempDir()
	valid := &scip.Index{
		Metadata:  &scip.Metadata{ProjectRoot: fileURI(root)},
		Documents: []*scip.Document{{Language: "go", RelativePath: "main.go"}},
	}
	body, err := proto.Marshal(valid)
	if err != nil {
		t.Fatal(err)
	}
	if count, err := validateScipIndex(root, body); err != nil || count != 1 {
		t.Fatalf("valid SCIP boundary failed: count=%d err=%v", count, err)
	}
	invalid := []*scip.Index{
		{},
		{Metadata: &scip.Metadata{ProjectRoot: fileURI(filepath.Join(root, "other"))}},
		{Metadata: valid.Metadata, Documents: []*scip.Document{{RelativePath: "../escape.go"}}},
		{Metadata: valid.Metadata, Documents: []*scip.Document{{RelativePath: "main.go"}, {RelativePath: "main.go"}}},
		{Metadata: valid.Metadata, Documents: []*scip.Document{{Language: "rust", RelativePath: "main.go"}}},
	}
	for index, value := range invalid {
		body, marshalErr := proto.Marshal(value)
		if marshalErr != nil {
			t.Fatal(marshalErr)
		}
		if _, validateErr := validateScipIndex(root, body); validateErr == nil {
			t.Errorf("invalid SCIP case %d was accepted", index)
		}
	}
	if _, err := validateScipIndex(root, []byte("not protobuf")); err == nil {
		t.Error("malformed protobuf was accepted")
	}
}

func TestModuleAndProcessBoundariesFailClosed(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "go.work"), []byte("not a work file"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := moduleRoots(root); err == nil {
		t.Error("malformed go.work was accepted")
	}
	buffer := &limitedBuffer{limit: 3}
	if count, err := buffer.Write([]byte("abcdef")); err != nil ||
		count != 6 || !buffer.exceeded || buffer.String() != "abc" {
		t.Fatalf(
			"bounded process output was not retained safely: %d %v %q",
			count,
			err,
			buffer.String(),
		)
	}
	if _, err := buildSnapshot(
		context.Background(),
		copyFixture(t),
		failingScipIndexer{},
		map[string]string{"GOVERSION": "go1.25.0"},
	); err == nil {
		t.Error("a failed SCIP generation was published")
	}
	if _, err := buildSnapshot(
		context.Background(),
		copyFixture(t),
		fixtureScipIndexer{version: "scip-go v10.2.70"},
		map[string]string{"GOVERSION": "go1.25.0"},
	); err == nil {
		t.Error("an incompatible scip-go version was accepted by substring")
	}
}

type fixtureScipIndexer struct {
	version string
}

func (indexer fixtureScipIndexer) Version(context.Context) (string, error) {
	if indexer.version != "" {
		return indexer.version, nil
	}
	return "scip-go v0.2.7", nil
}

func (fixtureScipIndexer) Index(_ context.Context, moduleRoot string) (scipArtifact, error) {
	var parts []string
	err := filepath.WalkDir(moduleRoot, func(file string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".go") {
			body, err := os.ReadFile(file)
			if err != nil {
				return err
			}
			parts = append(parts, filepath.ToSlash(file), digestBytes(body))
		}
		return nil
	})
	if err != nil {
		return scipArtifact{}, err
	}
	sort.Strings(parts)
	return scipArtifact{Digest: digestStrings(parts...), DocumentCount: len(parts)}, nil
}

type failingScipIndexer struct{}

func (failingScipIndexer) Version(context.Context) (string, error) {
	return "scip-go v0.2.7", nil
}

func (failingScipIndexer) Index(context.Context, string) (scipArtifact, error) {
	return scipArtifact{}, errors.New("fixture scip failure")
}

func copyFixture(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	if err := os.CopyFS(root, os.DirFS(filepath.Join("testdata", "work"))); err != nil {
		t.Fatal(err)
	}
	return root
}

func findNode(value snapshot, name string) *node {
	for index := range value.Nodes {
		if value.Nodes[index].Name == name {
			return &value.Nodes[index]
		}
	}
	return nil
}

func findQualifiedNode(value snapshot, qualified string) *node {
	for index := range value.Nodes {
		if value.Nodes[index].QualifiedName == qualified {
			return &value.Nodes[index]
		}
	}
	return nil
}

func countEdges(value snapshot, kind string) int {
	count := 0
	for _, relation := range value.Edges {
		if relation.Kind == kind {
			count++
		}
	}
	return count
}

func hasEdge(value snapshot, from, to, kind string) bool {
	for _, relation := range value.Edges {
		if relation.From == from && relation.To == to && relation.Kind == kind {
			return true
		}
	}
	return false
}

func fileURI(file string) string {
	path := filepath.ToSlash(file)
	if filepath.VolumeName(file) != "" && !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	return (&url.URL{Scheme: "file", Path: path}).String()
}
