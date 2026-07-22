package impl

import "testing"

func TestRun(t *testing.T) {
	if Run() == "" {
		t.Fatal("empty greeting")
	}
}
