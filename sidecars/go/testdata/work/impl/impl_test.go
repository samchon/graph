package impl

import (
	"fmt"
	"testing"
)

func TestRun(t *testing.T) {
	if Run() == "" {
		t.Fatal("empty greeting")
	}
}

func Testhelper() {
	_ = Resolve()
}

type falseTest struct{}

func (falseTest) TestMethod() {
	_ = Resolve()
}

func ExampleRun() {
	_ = Resolve()
	fmt.Println("impl")
	// Output: impl
}

func ExampleNotRun() {
	_ = Resolve()
}
