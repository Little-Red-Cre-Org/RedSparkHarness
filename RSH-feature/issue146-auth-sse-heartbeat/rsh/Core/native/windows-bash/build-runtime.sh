#!/usr/bin/env bash
# Build a prepared, patched MSYS source tree using an existing MSYS toolchain.
set -euo pipefail
export PATH=/usr/bin:/opt/bin:$PATH
export LC_ALL=C.UTF-8

if test "$#" -ne 2; then
  printf 'Usage: bash build-runtime.sh PATCHED_SOURCE NEW_BUILD_DIRECTORY\n' >&2
  exit 2
fi

source_dir=$(cd -- "$1" && pwd -P)
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
build_dir=$2
test -f "$source_dir/configure"
test -f "$source_dir/winsup/autogen.sh"
if test -e "$build_dir" || test -L "$build_dir"; then
  printf 'Build directory must not exist: %s\n' "$build_dir" >&2
  exit 2
fi
for tool in gcc g++ x86_64-w64-mingw32-g++ make patch perl autoconf automake; do
  command -v "$tool" >/dev/null
done

# Require the local patch before creating build outputs; this is not a source hash check.
patch --force --fuzz=0 --dry-run --reverse --directory="$source_dir" -p1 < "$script_dir/patches/restricted-ipc.patch"
mkdir -- "$build_dir"
build_dir=$(cd -- "$build_dir" && pwd -P)
(cd -- "$source_dir/winsup" && ./autogen.sh)
cd -- "$build_dir"
"$source_dir/configure" --build=x86_64-pc-cygwin --host=x86_64-pc-cygwin --target=x86_64-pc-cygwin --disable-dependency-tracking --disable-doc --with-msys2-runtime-commit=fb42d71358dd896ab324c52970f7d03f9ab0dfe5
make -j8 all-target-newlib configure-target-winsup
make -C x86_64-pc-cygwin/winsup/cygwin -j8 all
test -s x86_64-pc-cygwin/winsup/cygwin/new-msys-2.0.dll
