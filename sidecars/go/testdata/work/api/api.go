package api

type Greeter interface {
	Greet(name string) string
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
