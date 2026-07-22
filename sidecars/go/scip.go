package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/scip-code/scip/bindings/go/scip"
	"google.golang.org/protobuf/proto"
)

type scipArtifact struct {
	Digest        string
	DocumentCount int
}

type scipIndexer interface {
	Version(context.Context) (string, error)
	Index(context.Context, string) (scipArtifact, error)
}

type commandScipIndexer struct {
	command string
}

func resolveScipGo(root string) (string, error) {
	if override := os.Getenv("SAMCHON_GRAPH_SCIP_GO"); override != "" {
		if !filepath.IsAbs(override) {
			return "", errors.New("SAMCHON_GRAPH_SCIP_GO must be an absolute path")
		}
		if executableFile(override) {
			return override, nil
		}
		return "", fmt.Errorf("SAMCHON_GRAPH_SCIP_GO is not executable: %s", override)
	}
	names := []string{"scip-go"}
	if runtime.GOOS == "windows" {
		names = []string{"scip-go.exe", "scip-go.cmd", "scip-go.bat"}
	}
	for _, name := range names {
		candidate := filepath.Join(root, ".samchon-graph", "bin", name)
		if executableFile(candidate) {
			return candidate, nil
		}
	}
	resolved, err := exec.LookPath("scip-go")
	if err != nil {
		return "", errors.New("scip-go v0.2.7 was not found project-locally or on PATH")
	}
	return resolved, nil
}

func (runner commandScipIndexer) Version(ctx context.Context) (string, error) {
	stdout, stderr, err := runBounded(ctx, "", runner.command, "--version")
	if err != nil {
		return "", fmt.Errorf("query scip-go version: %w%s", err, stderrSuffix(stderr))
	}
	return strings.TrimSpace(stdout), nil
}

func (runner commandScipIndexer) Index(ctx context.Context, moduleRoot string) (scipArtifact, error) {
	directory, err := os.MkdirTemp("", "samchon-graph-go-scip-")
	if err != nil {
		return scipArtifact{}, fmt.Errorf("create SCIP output directory: %w", err)
	}
	defer os.RemoveAll(directory)
	output := filepath.Join(directory, "index.scip")
	_, stderr, err := runBounded(
		ctx,
		moduleRoot,
		runner.command,
		"index",
		"--quiet",
		"--module-root="+moduleRoot,
		"--output="+output,
		"./...",
	)
	if err != nil {
		return scipArtifact{}, fmt.Errorf("index %s with scip-go: %w%s", moduleRoot, err, stderrSuffix(stderr))
	}
	body, err := os.ReadFile(output)
	if err != nil {
		return scipArtifact{}, fmt.Errorf("read scip-go artifact: %w", err)
	}
	documents, err := validateScipIndex(moduleRoot, body)
	if err != nil {
		return scipArtifact{}, err
	}
	return scipArtifact{Digest: digestBytes(body), DocumentCount: documents}, nil
}

func validateScipIndex(moduleRoot string, body []byte) (int, error) {
	index := &scip.Index{}
	if err := proto.Unmarshal(body, index); err != nil {
		return 0, fmt.Errorf("decode scip-go artifact: %w", err)
	}
	if index.Metadata == nil {
		return 0, errors.New("scip-go artifact has no metadata")
	}
	declared, err := fileURIPath(index.Metadata.ProjectRoot)
	if err != nil {
		return 0, fmt.Errorf("decode scip-go project root: %w", err)
	}
	if !samePath(declared, moduleRoot) {
		return 0, fmt.Errorf("scip-go artifact belongs to %s, not %s", declared, moduleRoot)
	}
	seen := make(map[string]bool, len(index.Documents))
	for _, document := range index.Documents {
		relative := filepath.FromSlash(document.RelativePath)
		if document.RelativePath == "" || filepath.IsAbs(relative) || escapesRoot(relative) {
			return 0, fmt.Errorf("scip-go emitted an unsafe document path: %q", document.RelativePath)
		}
		cleaned := filepath.Clean(relative)
		if seen[cleaned] {
			return 0, fmt.Errorf("scip-go duplicated document path: %s", document.RelativePath)
		}
		seen[cleaned] = true
		if document.Language != "" && document.Language != "go" {
			return 0, fmt.Errorf("scip-go emitted a %s document: %s", document.Language, document.RelativePath)
		}
	}
	return len(index.Documents), nil
}

func fileURIPath(value string) (string, error) {
	parsed, err := url.Parse(value)
	if err != nil {
		return "", err
	}
	if parsed.Scheme == "" {
		return filepath.Clean(value), nil
	}
	if parsed.Scheme != "file" {
		return "", fmt.Errorf("unsupported URI scheme %q", parsed.Scheme)
	}
	path := parsed.Path
	if runtime.GOOS == "windows" && len(path) >= 3 && path[0] == '/' && path[2] == ':' {
		path = path[1:]
	}
	return filepath.FromSlash(path), nil
}

func runBounded(ctx context.Context, directory, command string, args ...string) (string, string, error) {
	executable, commandArgs := commandInvocation(command, args)
	process := exec.CommandContext(ctx, executable, commandArgs...)
	if directory != "" {
		process.Dir = directory
	}
	stdout := &limitedBuffer{limit: maxChildOutputBytes}
	stderr := &limitedBuffer{limit: maxChildOutputBytes}
	process.Stdout = stdout
	process.Stderr = stderr
	err := process.Run()
	if stdout.exceeded || stderr.exceeded {
		return stdout.String(), stderr.String(), fmt.Errorf(
			"%s exceeded the %d-byte output limit",
			command,
			maxChildOutputBytes,
		)
	}
	return stdout.String(), stderr.String(), err
}

func commandInvocation(command string, args []string) (string, []string) {
	if runtime.GOOS == "windows" {
		extension := strings.ToLower(filepath.Ext(command))
		if extension == ".cmd" || extension == ".bat" {
			return "cmd.exe", append([]string{"/d", "/s", "/c", command}, args...)
		}
	}
	return command, args
}

type limitedBuffer struct {
	buffer   bytes.Buffer
	limit    int
	exceeded bool
}

func (buffer *limitedBuffer) Write(body []byte) (int, error) {
	available := buffer.limit - buffer.buffer.Len()
	if available > 0 {
		chunk := body
		if len(chunk) > available {
			chunk = chunk[:available]
		}
		_, _ = buffer.buffer.Write(chunk)
	}
	if len(body) > available {
		buffer.exceeded = true
	}
	return len(body), nil
}

func (buffer *limitedBuffer) String() string {
	return buffer.buffer.String()
}

func executableFile(file string) bool {
	info, err := os.Stat(file)
	if err != nil || !info.Mode().IsRegular() {
		return false
	}
	if runtime.GOOS == "windows" {
		return true
	}
	return info.Mode().Perm()&0o111 != 0
}

func escapesRoot(relative string) bool {
	cleaned := filepath.Clean(relative)
	return cleaned == ".." || strings.HasPrefix(cleaned, ".."+string(filepath.Separator))
}

func samePath(left, right string) bool {
	left = filepath.Clean(left)
	right = filepath.Clean(right)
	if runtime.GOOS == "windows" {
		return strings.EqualFold(left, right)
	}
	return left == right
}

func stderrSuffix(stderr string) string {
	trimmed := strings.TrimSpace(stderr)
	if trimmed == "" {
		return ""
	}
	return ": " + trimmed
}

var _ io.Writer = (*limitedBuffer)(nil)

const maxChildOutputBytes = 16 * 1024 * 1024
