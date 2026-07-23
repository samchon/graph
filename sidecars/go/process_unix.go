//go:build !windows

package main

import (
	"os/exec"
	"syscall"
)

func configureOwnedProcess(command *exec.Cmd, _ string) {
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func terminateOwnedProcess(command *exec.Cmd) {
	if command.Process == nil {
		return
	}
	if err := syscall.Kill(-command.Process.Pid, syscall.SIGKILL); err != nil {
		_ = command.Process.Kill()
	}
}
