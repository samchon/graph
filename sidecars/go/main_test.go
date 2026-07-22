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
		"Greeter", "Transformer", "Input", "Left", "Right", "Box", "Base",
		"Service", "NewService", "ReadLeft", "Run", "TestRun",
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
	transformer := findQualifiedNode(first, "example.com/api.Transformer")
	if transformer == nil || !hasEdge(first, service.ID, transformer.ID, "implements") {
		t.Error("cross-module named signature identity lost Service's implementation")
	}
	leftField := findQualifiedNode(first, "example.com/api.Left.Value")
	readLeft := findQualifiedNode(first, "example.com/impl.ReadLeft")
	if leftField == nil || readLeft == nil || !hasEdge(first, readLeft.ID, leftField.ID, "accesses") {
		t.Error("same-named fields across modules made an exact selector ambiguous")
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
	if countNamedExternalTargets(first, run.ID, "Len", "references") != 1 {
		t.Error("one external selector did not normalize to one reference endpoint")
	}
	for _, falseTest := range []string{"Testhelper", "TestMethod", "ExampleNotRun"} {
		if node := findNode(first, falseTest); node == nil || countEdgesFrom(first, node.ID, "tests") != 0 {
			t.Errorf("non-entrypoint %s was classified as an executable Go test", falseTest)
		}
	}
	if example := findNode(first, "ExampleRun"); example == nil || countEdgesFrom(first, example.ID, "tests") == 0 {
		t.Error("a runnable Go example did not publish its tested call")
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
		Metadata: &scip.Metadata{
			ProjectRoot: fileURI(root),
			ToolInfo: &scip.ToolInfo{
				Name: "scip-go", Version: "0.2.7", Arguments: []string{"--module-root=" + root},
			},
		},
		Documents: []*scip.Document{{
			Language: "go", RelativePath: "main.go",
			Occurrences: []*scip.Occurrence{{Symbol: "scip-go gomod example.com/test  main().", SymbolRoles: 1}},
		}},
	}
	body, err := proto.Marshal(valid)
	if err != nil {
		t.Fatal(err)
	}
	artifact, err := validateScipIndex(root, body)
	if err != nil || len(artifact.Documents) != 1 {
		t.Fatalf("valid SCIP boundary failed: artifact=%#v err=%v", artifact, err)
	}
	otherRoot := t.TempDir()
	other := proto.Clone(valid).(*scip.Index)
	other.Metadata.ProjectRoot = fileURI(otherRoot)
	other.Metadata.ToolInfo.Arguments = []string{"--module-root=" + otherRoot}
	otherBody, err := proto.Marshal(other)
	if err != nil {
		t.Fatal(err)
	}
	otherArtifact, err := validateScipIndex(otherRoot, otherBody)
	if err != nil || artifact.Digest != otherArtifact.Digest {
		t.Error("SCIP digest retained checkout or invocation paths")
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

func TestScipDigestAndUniverseIgnoreCheckoutLocations(t *testing.T) {
	left := copyFixture(t)
	right := copyFixture(t)
	leftSnapshot, err := buildSnapshot(context.Background(), left, fixtureScipIndexer{}, fixtureEnvironment(left))
	if err != nil {
		t.Fatal(err)
	}
	rightSnapshot, err := buildSnapshot(context.Background(), right, fixtureScipIndexer{}, fixtureEnvironment(right))
	if err != nil {
		t.Fatal(err)
	}
	if leftSnapshot.Universe != rightSnapshot.Universe {
		t.Error("equivalent checkouts produced location-dependent Go universes")
	}
	if _, err := buildSnapshot(
		context.Background(),
		left,
		missingScipDocumentIndexer{},
		fixtureEnvironment(left),
	); err == nil {
		t.Error("a SCIP artifact that omitted checker-owned sources was accepted")
	}
	if _, err := buildSnapshot(
		context.Background(),
		left,
		emptyScipDefinitionsIndexer{},
		fixtureEnvironment(left),
	); err == nil {
		t.Error("a SCIP artifact with no semantic definitions was accepted")
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
	outside := t.TempDir()
	workspaceRoot := t.TempDir()
	if err := os.WriteFile(
		filepath.Join(workspaceRoot, "go.work"),
		[]byte("go 1.25\nuse "+filepath.ToSlash(outside)+"\n"),
		0o644,
	); err != nil {
		t.Fatal(err)
	}
	if _, err := moduleRoots(workspaceRoot); err == nil {
		t.Error("a go.work module outside the indexed project was accepted")
	}
	moduleRoot := t.TempDir()
	if err := os.WriteFile(
		filepath.Join(moduleRoot, "go.mod"),
		[]byte("module example.com/root\n\ngo 1.25\n\nreplace example.com/dep => "+filepath.ToSlash(outside)+"\n"),
		0o644,
	); err != nil {
		t.Fatal(err)
	}
	if _, err := moduleRoots(moduleRoot); err == nil {
		t.Error("a local replacement outside the indexed project was accepted")
	}
	inputRoot := t.TempDir()
	for file, body := range map[string]string{
		"go.mod":                          "module example.com/inputs\n\ngo 1.25\n",
		"native.h":                        "#define VALUE 1\n",
		"embedded/main.go":                "package embedded\n\nimport \"embed\"\n\n//go:embed assets/* local.txt\nvar content embed.FS\n",
		"embedded/assets/message.txt":     "embedded build data\n",
		"embedded/local.txt":              "local build data\n",
		"vendor/modules.txt":              "# pinned\n",
		"vendor/example.com/dep/dep.go":   "package dep\n",
		"vendor/example.com/dep/data.bin": "vendored build data\n",
		"vendor/.git/ignored.go":          "ignored\n",
	} {
		absolute := filepath.Join(inputRoot, filepath.FromSlash(file))
		if err := os.MkdirAll(filepath.Dir(absolute), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(absolute, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	inputs, err := buildInputs(inputRoot)
	if err != nil {
		t.Fatal(err)
	}
	for index := range inputs {
		relative, relativeErr := filepath.Rel(inputRoot, inputs[index])
		if relativeErr != nil {
			t.Fatal(relativeErr)
		}
		inputs[index] = filepath.ToSlash(relative)
	}
	wantInputs := []string{
		"embedded/assets/message.txt",
		"embedded/local.txt",
		"go.mod",
		"native.h",
		"vendor/example.com/dep/data.bin",
		"vendor/example.com/dep/dep.go",
		"vendor/modules.txt",
	}
	if !reflect.DeepEqual(inputs, wantInputs) {
		t.Fatalf("Go build inputs do not fence auxiliary and vendored bytes: got %v want %v", inputs, wantInputs)
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

func TestGoToolchainResolutionKeepsAnalysisOnTheSelectedToolchain(t *testing.T) {
	root := t.TempDir()
	name := "go"
	if runtime.GOOS == "windows" {
		name = "go.cmd"
	}
	command := filepath.Join(root, ".samchon-graph", "bin", name)
	if err := os.MkdirAll(filepath.Dir(command), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(command, []byte("toolchain"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("SAMCHON_GRAPH_GO_TOOLCHAIN", "")
	resolved, err := resolveGoToolchain(root)
	if err != nil {
		t.Fatal(err)
	}
	if !samePath(resolved, command) {
		t.Fatalf("project-local Go toolchain was not selected: got %s want %s", resolved, command)
	}
	var pathValue string
	for _, entry := range goToolchainEnvironment(resolved) {
		key, value, found := strings.Cut(entry, "=")
		if found && strings.EqualFold(key, "PATH") {
			pathValue = value
		}
	}
	if first, _, _ := strings.Cut(pathValue, string(filepath.ListSeparator)); !samePath(first, filepath.Dir(command)) {
		t.Fatalf("go/packages PATH did not prefer the selected Go toolchain: %q", pathValue)
	}
	t.Setenv("SAMCHON_GRAPH_GO_TOOLCHAIN", "relative/go")
	if _, err := resolveGoToolchain(root); err == nil {
		t.Error("a relative Go toolchain override was accepted")
	}
}

func TestProjectBoundaryAllowsOnlySharedSymlinkPrefixes(t *testing.T) {
	realRoot := t.TempDir()
	module := filepath.Join(realRoot, "module")
	if err := os.Mkdir(module, 0o755); err != nil {
		t.Fatal(err)
	}
	alias := filepath.Join(t.TempDir(), "root")
	if err := os.Symlink(realRoot, alias); err != nil {
		t.Skipf("create project-root symlink: %v", err)
	}
	if !withinProjectBoundary(alias, filepath.Join(alias, "module")) {
		t.Error("a module below a shared project-root symlink was rejected")
	}

	outside := t.TempDir()
	escape := filepath.Join(alias, "escape")
	if err := os.Symlink(outside, escape); err != nil {
		t.Skipf("create nested escape symlink: %v", err)
	}
	if withinProjectBoundary(alias, escape) {
		t.Error("a nested symlink that escapes the project was accepted")
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
	var documents []string
	definitions := map[string]int{}
	err := filepath.WalkDir(moduleRoot, func(file string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".go") {
			body, err := os.ReadFile(file)
			if err != nil {
				return err
			}
			relative, err := filepath.Rel(moduleRoot, file)
			if err != nil {
				return err
			}
			parts = append(parts, filepath.ToSlash(relative), digestBytes(body))
			documents = append(documents, file)
			definitions[pathKey(file)] = 1
		}
		return nil
	})
	if err != nil {
		return scipArtifact{}, err
	}
	sort.Strings(parts)
	sort.Strings(documents)
	return scipArtifact{
		Digest: digestStrings(parts...), Documents: documents, Definitions: definitions,
	}, nil
}

type missingScipDocumentIndexer struct{ fixtureScipIndexer }

func (missingScipDocumentIndexer) Index(
	ctx context.Context,
	moduleRoot string,
) (scipArtifact, error) {
	artifact, err := (fixtureScipIndexer{}).Index(ctx, moduleRoot)
	if err != nil {
		return scipArtifact{}, err
	}
	if len(artifact.Documents) > 0 {
		delete(artifact.Definitions, pathKey(artifact.Documents[0]))
		artifact.Documents = artifact.Documents[1:]
	}
	return artifact, nil
}

type emptyScipDefinitionsIndexer struct{ fixtureScipIndexer }

func (emptyScipDefinitionsIndexer) Index(
	ctx context.Context,
	moduleRoot string,
) (scipArtifact, error) {
	artifact, err := (fixtureScipIndexer{}).Index(ctx, moduleRoot)
	artifact.Definitions = map[string]int{}
	return artifact, err
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

func fixtureEnvironment(root string) map[string]string {
	return map[string]string{
		"GOVERSION":   "go1.25.0",
		"GOOS":        "fixture",
		"GOARCH":      "fixture",
		"CGO_ENABLED": "0",
		"GOFLAGS":     "",
		"GOWORK":      filepath.Join(root, "go.work"),
	}
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

func countEdgesFrom(value snapshot, from, kind string) int {
	count := 0
	for _, relation := range value.Edges {
		if relation.From == from && relation.Kind == kind {
			count++
		}
	}
	return count
}

func countNamedExternalTargets(value snapshot, from, name, kind string) int {
	external := map[string]bool{}
	for _, candidate := range value.Nodes {
		if candidate.External && candidate.Name == name {
			external[candidate.ID] = true
		}
	}
	count := 0
	for _, relation := range value.Edges {
		if relation.From == from && relation.Kind == kind && external[relation.To] {
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
