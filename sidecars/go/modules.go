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

func moduleRoots(root string) ([]string, error) {
	workspace := filepath.Join(root, "go.work")
	if body, err := os.ReadFile(workspace); err == nil {
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
			roots = append(roots, filepath.Clean(absolute))
		}
		return uniqueSorted(roots), nil
	} else if !os.IsNotExist(err) {
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
	return uniqueSorted(roots), nil
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
			if isNestedRepository(current) {
				return filepath.SkipDir
			}
			if ignoredDirectory(entry.Name()) {
				if entry.Name() == "vendor" {
					modules := filepath.Join(current, "modules.txt")
					if _, statErr := os.Stat(modules); statErr == nil {
						inputs = append(inputs, modules)
					}
				}
				return filepath.SkipDir
			}
		}
		if !entry.IsDir() && names[entry.Name()] {
			inputs = append(inputs, current)
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("discover Go build inputs: %w", err)
	}
	return uniqueSorted(inputs), nil
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
