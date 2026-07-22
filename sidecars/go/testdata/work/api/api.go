package api

type Greeter interface {
	Greet(name string) string
}

type Input string

type Transformer interface {
	Transform(Input) Input
}

type Left struct {
	Value string
}

type Right struct {
	Value string
}

type Box[T any] struct {
	Value T
}

func Invoke(g Greeter) string {
	return g.Greet("world")
}

func Resolve() string {
	return "api"
}
