package impl

import (
	"strings"

	"example.com/api"
)

type Base struct{}

func (Base) Greet(name string) string {
	return "hello " + name
}

func (Base) Transform(value api.Input) api.Input {
	return value
}

type Service struct {
	Base
	Box   api.Box[string]
	Count int
}

func NewService() *Service {
	return &Service{Box: api.Box[string]{Value: "ready"}}
}

func Resolve() string {
	return "impl"
}

func ReadLeft(value api.Left) string {
	return value.Value
}

func Run() string {
	service := NewService()
	service.Count++
	greeter := service.Greet
	_ = greeter
	var builder strings.Builder
	length := builder.Len
	_ = length
	_ = Resolve()
	var dynamic any = func() string { return "dynamic" }
	_ = dynamic.(func() string)()
	return api.Invoke(service)
}
