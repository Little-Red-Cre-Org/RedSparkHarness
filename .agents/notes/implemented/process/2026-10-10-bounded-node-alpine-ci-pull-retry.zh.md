# Agent Note: Node Alpine CI 镜像拉取的有限重试

Status: implemented

[English](2026-10-10-bounded-node-alpine-ci-pull-retry.md) | 中文

## 问题

Linux Node addon 作业可能在兼容性测试开始前失败，因为 Docker 获取官方 Node Alpine 镜像的 auth token 时发生超时。已观察到的失败指向同一个 Docker Hub token 端点，并在等待响应头时超时。

## 决策

[工作流](../../../../.github/workflows/node-addon-system.yml)中的四个 Linux Alpine 步骤使用仅负责拉取镜像的[辅助程序](../../../../rsh/Core/native/system/scripts/pull-node-image.mjs)。只有拉取 stderr 同时包含 "auth.docker.io/token" 和 "Client.Timeout exceeded while awaiting headers" 时，辅助程序才会等待一秒并重试一次。拉取成功后，工作流只执行一次原有容器命令，并传入 "--pull=never"；镜像标签、挂载、工作目录和测试参数均保持不变。[宿主侧测试](../../../../rsh/Core/native/system/test/pull-node-image.test.js)覆盖两种已观察到的超时文本，不需要 Docker 或网络。

## 备选方案

**重试整个容器命令。** 否决，因为它会重新运行测试，并可能混淆测试失败与 registry 传输失败。

**重试所有拉取错误。** 否决，因为认证被拒、标签缺失和平台不受支持都应立即失败，而不是再等待一次拉取。

**更换镜像来源或 Docker daemon 设置。** 否决，因为这会改变被测镜像来源或运行器配置；registry 缓存不能保证提供独立的恢复路径。

## 后果

只有已观察到的 auth-token 响应头超时会多一次拉取。官方镜像引用和兼容性测试调用保持不变，持续的 registry 故障仍会作为可见的 CI 失败报告。