package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/url"
	"sort"
	"strconv"
	"strings"
)

type snapshot struct {
	SchemaVersion int          `json:"schemaVersion"`
	ProjectRoot   string       `json:"projectRoot"`
	Languages     []string     `json:"languages"`
	Tool          tool         `json:"tool"`
	Universe      string       `json:"universe"`
	Capabilities  []string     `json:"capabilities"`
	Sources       []source     `json:"sources"`
	Nodes         []node       `json:"nodes"`
	Edges         []edge       `json:"edges"`
	Diagnostics   []diagnostic `json:"diagnostics"`
	Warnings      []string     `json:"warnings"`
}

type tool struct {
	Name            string `json:"name"`
	Version         string `json:"version"`
	CompilerVersion string `json:"compilerVersion"`
	ProtocolVersion int    `json:"protocolVersion"`
}

type source struct {
	File          string `json:"file"`
	CheckerDigest string `json:"checkerDigest"`
	DiskDigest    string `json:"diskDigest"`
}

type node struct {
	ID            string    `json:"id"`
	Kind          string    `json:"kind"`
	Language      string    `json:"language"`
	Name          string    `json:"name"`
	QualifiedName string    `json:"qualifiedName,omitempty"`
	File          string    `json:"file"`
	External      bool      `json:"external"`
	Exported      bool      `json:"exported,omitempty"`
	Closure       bool      `json:"closure,omitempty"`
	Modifiers     []string  `json:"modifiers,omitempty"`
	Evidence      *evidence `json:"evidence,omitempty"`
}

type edge struct {
	From     string    `json:"from"`
	To       string    `json:"to"`
	Kind     string    `json:"kind"`
	Evidence *evidence `json:"evidence,omitempty"`
}

type diagnostic struct {
	File     string `json:"file"`
	Line     int    `json:"line"`
	Column   int    `json:"column,omitempty"`
	Code     any    `json:"code"`
	Message  string `json:"message"`
	Severity string `json:"severity,omitempty"`
}

type evidence struct {
	File      string `json:"file"`
	StartLine int    `json:"startLine"`
	StartCol  int    `json:"startCol,omitempty"`
	EndLine   int    `json:"endLine,omitempty"`
	EndCol    int    `json:"endCol,omitempty"`
}

func semanticID(kind, symbol, display string, generation bool) string {
	prefix := "@v2"
	if generation {
		prefix = "@g2"
	}
	digest := sha256.Sum256([]byte("go\x00" + kind + "\x00" + symbol))
	return prefix + "/go/" + hex.EncodeToString(digest[:]) + "#" +
		url.QueryEscape(display) + ":" + kind
}

func digestBytes(body []byte) string {
	digest := sha256.Sum256(body)
	return hex.EncodeToString(digest[:])
}

func digestStrings(values ...string) string {
	hash := sha256.New()
	for _, value := range values {
		hash.Write([]byte(strconv.Itoa(len(value))))
		hash.Write([]byte{':'})
		hash.Write([]byte(value))
	}
	return hex.EncodeToString(hash.Sum(nil))
}

func canonicalSnapshot(value snapshot) ([]byte, error) {
	return json.Marshal(value)
}

func sortSnapshot(value *snapshot) {
	sort.Slice(value.Sources, func(i, j int) bool {
		return value.Sources[i].File < value.Sources[j].File
	})
	sort.Slice(value.Nodes, func(i, j int) bool {
		return value.Nodes[i].ID < value.Nodes[j].ID
	})
	sort.Slice(value.Edges, func(i, j int) bool {
		return edgeKey(value.Edges[i]) < edgeKey(value.Edges[j])
	})
	sort.Slice(value.Diagnostics, func(i, j int) bool {
		left := diagnosticKey(value.Diagnostics[i])
		right := diagnosticKey(value.Diagnostics[j])
		return left < right
	})
	sort.Strings(value.Warnings)
}

func edgeKey(value edge) string {
	position := ""
	if value.Evidence != nil {
		position = strings.Join([]string{
			value.Evidence.File,
			strconv.Itoa(value.Evidence.StartLine),
			strconv.Itoa(value.Evidence.StartCol),
		}, "\x00")
	}
	return value.Kind + "\x00" + value.From + "\x00" + value.To + "\x00" + position
}

func diagnosticKey(value diagnostic) string {
	return value.File + "\x00" + strconv.Itoa(value.Line) + "\x00" +
		strconv.Itoa(value.Column) + "\x00" + value.Message
}
