# Windows Bash 运行时源码

[English](README.md) | 中文

## 概述

本目录提供实验性的 MSYS 运行时补丁和构建输入，用于研究 Windows 受限令牌下的 Bash 兼容性。它不安装 Bash、不替换系统 Git，也不改变已交付 Harness 配置方案所选择的运行时。

## 目录

- [源码准备](#source-preparation)
- [构建输入](#build-inputs)
- [限制](#limitations)
- [Dev Note](#dev-note)

<a id="source-preparation"></a>
## 源码准备

[upstream.json](upstream.json) 固定源码压缩包和补丁的哈希。[prepare-source.ps1](prepare-source.ps1) 接受已有压缩包和新目标目录，在解压前校验两个哈希，应用补丁并返回准备好的源码目录。解压或补丁失败时保留部分生成的目标目录供检查；脚本不会替换已有目标目录。构建主机必须提供 PowerShell、Git 和 tar。

<a id="build-inputs"></a>
## 构建输入

[build-runtime.sh](build-runtime.sh) 接受准备好的源码目录和不存在的构建目录。它要求 MSYS 工具链，包括 MSYS 编译器以及 `/opt/bin` 下的 MinGW 交叉编译器。它检查补丁是否存在，运行上游 autotools 生成步骤，并构建 newlib 和运行时子目录。补丁存在检查不是完整的源码完整性检查；应使用源码准备脚本处理固定的压缩包。

<a id="limitations"></a>
## 限制

[prepare-distribution.ps1](prepare-distribution.ps1) 使用固定的 PortableGit 压缩包和调用方提供的 DLL 组装新目录。它校验压缩包、原始 MSYS DLL 和复制后的 DLL 字节。调用方提供 7-Zip 可执行文件，并且必须独立验证替换 DLL；组装并不证明其源码来源或安全属性。

这些脚本不锁定或安装工具链包。[Desktop 打包](../../../Programs/Desktop/README.zh.md#package)使用显式准备的发行目录；更广泛的安全验收和安装程序验收仍是独立要求。本目录的任何二进制文件都不是已发布的 Harness 依赖。

补丁将已有的受限 SID 加入部分新建 IPC 对象的 ACL。它不改变令牌的受限 SID 列表，也不授予文件系统写入权限。其覆盖范围仅限于修改的上游路径；它不是 Windows 受限令牌兼容性的通用实现。

<a id="dev-note"></a>
## Dev Note

[物理迁移提案](../../../../.agents/notes/proposed/architecture/2026-09-18-rsh-physical-layout-migration.zh.md) 记录持续进行的集成工作和验证背景。
