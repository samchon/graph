package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "samchon-graph-go:", err)
		os.Exit(1)
	}
}

func run() error {
	output := flag.String("output", "", "write the normalized snapshot to this file")
	flag.Parse()
	if *output == "" {
		return errors.New("--output is required")
	}
	root, err := filepath.Abs(".")
	if err != nil {
		return fmt.Errorf("resolve project root: %w", err)
	}
	command, err := resolveScipGo(root)
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	environment, err := probeGoEnvironment(ctx, root)
	if err != nil {
		return err
	}
	value, err := buildSnapshot(ctx, root, commandScipIndexer{command: command}, environment)
	if err != nil {
		return err
	}
	return writeSnapshot(*output, value)
}

func buildSnapshot(
	ctx context.Context,
	root string,
	indexer scipIndexer,
	environment map[string]string,
) (snapshot, error) {
	roots, err := moduleRoots(root)
	if err != nil {
		return snapshot{}, err
	}
	version, err := indexer.Version(ctx)
	if err != nil {
		return snapshot{}, err
	}
	if !matchesPinnedScipGoVersion(version) {
		return snapshot{}, fmt.Errorf("scip-go compatibility requires %s, got %q", pinnedScipGoVersion, version)
	}
	artifacts := make([]scipArtifact, 0, len(roots))
	documents := 0
	for _, moduleRoot := range roots {
		artifact, indexErr := indexer.Index(ctx, moduleRoot)
		if indexErr != nil {
			return snapshot{}, indexErr
		}
		artifacts = append(artifacts, artifact)
		documents += artifact.DocumentCount
	}
	if documents == 0 {
		return snapshot{}, errors.New("scip-go published no Go documents")
	}
	graph, err := analyzeGo(ctx, root, roots)
	if err != nil {
		return snapshot{}, err
	}
	sources, nodes, edges := graph.snapshotParts()
	inputs, err := buildInputs(root)
	if err != nil {
		return snapshot{}, err
	}
	universeParts := []string{"samchon-graph-go", sidecarVersion, version}
	keys := make([]string, 0, len(environment))
	for key := range environment {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		universeParts = append(universeParts, key, environment[key])
	}
	for index, moduleRoot := range roots {
		universeParts = append(universeParts, moduleRoot, artifacts[index].Digest)
	}
	for _, input := range inputs {
		body, readErr := os.ReadFile(input)
		if readErr != nil {
			return snapshot{}, fmt.Errorf("read Go build input %s: %w", input, readErr)
		}
		identity, relativeErr := filepath.Rel(root, input)
		if relativeErr != nil {
			return snapshot{}, fmt.Errorf("name Go build input %s: %w", input, relativeErr)
		}
		universeParts = append(universeParts, filepath.ToSlash(identity), digestBytes(body))
	}
	for _, file := range sources {
		universeParts = append(universeParts, file.File, file.CheckerDigest)
	}
	warnings := []string{}
	if graph.unresolved != 0 {
		warnings = append(
			warnings,
			fmt.Sprintf(
				"samchon-graph-go: %d expression target(s) remained local, dynamic, "+
					"or unresolved and were not assigned fabricated endpoints",
				graph.unresolved,
			),
		)
	}
	compilerVersion := environment["GOVERSION"]
	value := snapshot{
		SchemaVersion: 1,
		ProjectRoot:   root,
		Languages:     []string{"go"},
		Tool: tool{
			Name: "samchon-graph-go", Version: sidecarVersion + "+scip-go." + pinnedScipGoVersion,
			CompilerVersion: compilerVersion, ProtocolVersion: 1,
		},
		Universe: digestStrings(universeParts...),
		Capabilities: []string{
			"universe", "sourceDigests", "diskDigests", "diagnostics",
			"scipNavigation", "goPackages", "fullRebuild",
		},
		Sources: sources, Nodes: nodes, Edges: edges,
		Diagnostics: []diagnostic{}, Warnings: warnings,
	}
	sortSnapshot(&value)
	return value, nil
}

func matchesPinnedScipGoVersion(version string) bool {
	for _, field := range strings.Fields(version) {
		candidate := strings.Trim(field, ",;()[]{}")
		if candidate == pinnedScipGoVersion || candidate == "v"+pinnedScipGoVersion {
			return true
		}
	}
	return false
}

func probeGoEnvironment(ctx context.Context, root string) (map[string]string, error) {
	stdout, stderr, err := runBounded(
		ctx,
		root,
		"go",
		"env",
		"-json",
		"GOVERSION",
		"GOOS",
		"GOARCH",
		"CGO_ENABLED",
		"GOFLAGS",
		"GOWORK",
		"GOPROXY",
		"GOPRIVATE",
	)
	if err != nil {
		return nil, fmt.Errorf("query Go build environment: %w%s", err, stderrSuffix(stderr))
	}
	value := map[string]string{}
	if err := json.Unmarshal([]byte(stdout), &value); err != nil {
		return nil, fmt.Errorf("decode Go build environment: %w", err)
	}
	return value, nil
}

func writeSnapshot(output string, value snapshot) error {
	if err := os.MkdirAll(filepath.Dir(output), 0o755); err != nil {
		return fmt.Errorf("create snapshot directory: %w", err)
	}
	temporary, err := os.CreateTemp(filepath.Dir(output), "snapshot-*.json")
	if err != nil {
		return fmt.Errorf("create snapshot artifact: %w", err)
	}
	temporaryName := temporary.Name()
	defer os.Remove(temporaryName)
	encoder := json.NewEncoder(temporary)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		temporary.Close()
		return fmt.Errorf("encode snapshot: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close snapshot artifact: %w", err)
	}
	if err := os.Rename(temporaryName, output); err != nil {
		return fmt.Errorf("publish snapshot artifact: %w", err)
	}
	return nil
}

const (
	sidecarVersion      = "0.1.0"
	pinnedScipGoVersion = "0.2.7"
)
