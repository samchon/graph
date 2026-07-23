//go:build windows

package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"syscall"
)

const createNewProcessGroup = 0x00000200

func configureOwnedProcess(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: createNewProcessGroup,
		HideWindow:    true,
	}
}

func terminateOwnedProcess(command *exec.Cmd) {
	if command.Process == nil {
		return
	}
	systemRoot := os.Getenv("SystemRoot")
	if systemRoot == "" {
		systemRoot = `C:\Windows`
	}
	killer := exec.Command(
		filepath.Join(systemRoot, "System32", "taskkill.exe"),
		"/pid",
		strconv.Itoa(command.Process.Pid),
		"/t",
		"/f",
	)
	killer.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if err := killer.Run(); err != nil {
		_ = command.Process.Kill()
	}
}
