package impl

import "example.com/api"

type Base struct{}

func (Base) Greet(name string) string {
	return "hello " + name
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

func Run() string {
	service := NewService()
	service.Count++
	greeter := service.Greet
	_ = greeter
	_ = Resolve()
	var dynamic any = func() string { return "dynamic" }
	_ = dynamic.(func() string)()
	return api.Invoke(service)
}
