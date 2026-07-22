package main

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"golang.org/x/mod/modfile"
)

func moduleRoots(root string, effectiveWorkspace ...string) ([]string, error) {
	workspace := filepath.Join(root, "go.work")
	workspaceEnabled := len(effectiveWorkspace) == 0 || effectiveWorkspace[0] != "off"
	if body, err := os.ReadFile(workspace); workspaceEnabled && err == nil {
		parsed, parseErr := modfile.ParseWork(workspace, body, nil)
		if parseErr != nil {
			return nil, fmt.Errorf("parse go.work: %w", parseErr)
		}
		roots := make([]string, 0, len(parsed.Use))
		for _, use := range parsed.Use {
			candidate := use.Path
			if !filepath.IsAbs(candidate) {
				candidate = filepath.Join(root, candidate)
			}
			absolute, absoluteErr := filepath.Abs(candidate)
			if absoluteErr != nil {
				return nil, fmt.Errorf("resolve go.work use %q: %w", use.Path, absoluteErr)
			}
			if !withinProjectBoundary(root, absolute) {
				return nil, fmt.Errorf(
					"go.work use %q crosses the indexed project boundary; use the generic Go lane or move the module inside %s",
					use.Path,
					root,
				)
			}
			roots = append(roots, filepath.Clean(absolute))
		}
		if err := validateLocalReplacements(root, workspace, parsed.Replace); err != nil {
			return nil, err
		}
		roots = uniqueSorted(roots)
		if err := validateModuleReplacements(root, roots); err != nil {
			return nil, err
		}
		return roots, nil
	} else if workspaceEnabled && !os.IsNotExist(err) {
		return nil, fmt.Errorf("read go.work: %w", err)
	}

	var roots []string
	err := filepath.WalkDir(root, func(current string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() && current != root {
			if ignoredDirectory(entry.Name()) || isNestedRepository(current) {
				return filepath.SkipDir
			}
		}
		if !entry.IsDir() && entry.Name() == "go.mod" {
			roots = append(roots, filepath.Dir(current))
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("discover Go modules: %w", err)
	}
	if len(roots) == 0 {
		roots = append(roots, root)
	}
	roots = uniqueSorted(roots)
	if err := validateModuleReplacements(root, roots); err != nil {
		return nil, err
	}
	return roots, nil
}

func validateModuleReplacements(root string, roots []string) error {
	for _, moduleRoot := range roots {
		manifest := filepath.Join(moduleRoot, "go.mod")
		body, err := os.ReadFile(manifest)
		if os.IsNotExist(err) && samePath(moduleRoot, root) {
			continue
		}
		if err != nil {
			return fmt.Errorf("read %s: %w", manifest, err)
		}
		parsed, err := modfile.Parse(manifest, body, nil)
		if err != nil {
			return fmt.Errorf("parse %s: %w", manifest, err)
		}
		if err := validateLocalReplacements(root, manifest, parsed.Replace); err != nil {
			return err
		}
	}
	return nil
}

func validateLocalReplacements(root, manifest string, replacements []*modfile.Replace) error {
	for _, replacement := range replacements {
		if replacement.New.Version != "" {
			continue
		}
		candidate := replacement.New.Path
		if !filepath.IsAbs(candidate) {
			candidate = filepath.Join(filepath.Dir(manifest), candidate)
		}
		absolute, err := filepath.Abs(candidate)
		if err != nil {
			return fmt.Errorf("resolve local replacement %q in %s: %w", replacement.New.Path, manifest, err)
		}
		if !withinProjectBoundary(root, absolute) {
			return fmt.Errorf(
				"local replacement %q in %s crosses the indexed project boundary; use the generic Go lane or move the replacement inside %s",
				replacement.New.Path,
				manifest,
				root,
			)
		}
	}
	return nil
}

func withinProjectBoundary(root, candidate string) bool {
	if !within(root, candidate) {
		return false
	}
	resolved, err := filepath.EvalSymlinks(candidate)
	if err != nil || !samePath(resolved, candidate) {
		return false
	}
	relative, err := filepath.Rel(root, candidate)
	if err != nil {
		return false
	}
	cursor := filepath.Clean(root)
	for _, segment := range strings.Split(filepath.Clean(relative), string(filepath.Separator)) {
		if segment == "." || segment == "" {
			continue
		}
		cursor = filepath.Join(cursor, segment)
		if _, err := os.Stat(filepath.Join(cursor, ".git")); err == nil {
			return false
		}
	}
	return true
}

func buildInputs(root string) ([]string, error) {
	names := map[string]bool{
		"go.mod": true, "go.sum": true, "go.work": true, "go.work.sum": true,
	}
	var inputs []string
	err := filepath.WalkDir(root, func(current string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() && current != root {
			if entry.Name() == "vendor" {
				vendor, err := vendorInputs(current)
				if err != nil {
					return err
				}
				inputs = append(inputs, vendor...)
				return filepath.SkipDir
			}
			if isNestedRepository(current) {
				return filepath.SkipDir
			}
			if ignoredDirectory(entry.Name()) {
				return filepath.SkipDir
			}
		}
		if !entry.IsDir() && (names[entry.Name()] || goAuxiliaryExtension(filepath.Ext(entry.Name()))) {
			inputs = append(inputs, current)
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("discover Go build inputs: %w", err)
	}
	return uniqueSorted(inputs), nil
}

func vendorInputs(root string) ([]string, error) {
	var inputs []string
	err := filepath.WalkDir(root, func(current string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() && entry.Name() == ".git" {
			return filepath.SkipDir
		}
		if !entry.IsDir() && entry.Type().IsRegular() {
			inputs = append(inputs, current)
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("discover vendored Go build inputs: %w", err)
	}
	return inputs, nil
}

func goAuxiliaryExtension(extension string) bool {
	switch strings.ToLower(extension) {
	case ".c", ".cc", ".cpp", ".cxx", ".f", ".for", ".f90", ".h", ".hh",
		".hpp", ".hxx", ".m", ".s", ".sx", ".swig", ".swigcxx", ".syso":
		return true
	default:
		return false
	}
}

func isNestedRepository(directory string) bool {
	_, err := os.Stat(filepath.Join(directory, ".git"))
	return err == nil
}

func ignoredDirectory(name string) bool {
	switch name {
	case ".git", ".hg", ".svn", "node_modules", "vendor", "dist", "build",
		"target", "out", "coverage", ".cache", ".samchon-graph":
		return true
	default:
		return strings.HasPrefix(name, ".") && name != "."
	}
}

func uniqueSorted(values []string) []string {
	seen := make(map[string]bool, len(values))
	output := make([]string, 0, len(values))
	for _, value := range values {
		cleaned := filepath.Clean(value)
		if !seen[cleaned] {
			seen[cleaned] = true
			output = append(output, cleaned)
		}
	}
	sort.Strings(output)
	return output
}
