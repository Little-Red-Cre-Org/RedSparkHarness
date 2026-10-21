/** Task entry: compile and run a single file with inherited interactive terminal handles. */
import { spawnSync } from 'node:child_process'
import { basename, dirname, isAbsolute, join } from 'node:path'

const [language, file, directory, executable, javac] = process.argv.slice(2)
if (!language || !file || !directory || !executable || !javac) throw new Error('Missing IDE run arguments')

function run(command: string, args: string[]): number {
  const pathKey = Object.keys(process.env).find(key => key.toLowerCase() === 'path') ?? 'PATH'
  const env = { ...process.env }
  if (isAbsolute(executable)) env[pathKey] = dirname(executable) + (process.platform === 'win32' ? ';' : ':') + (env[pathKey] ?? '')
  const result = spawnSync(command, args, { stdio: 'inherit', windowsHide: true, env })
  if (result.error) { console.error(result.error.message); return 1 }
  return result.status ?? 1
}

let exitCode: number
if (language === 'c' || language === 'cpp') {
  const binary = join(directory, process.platform === 'win32' ? 'program.exe' : 'program')
  const compiled = run(executable, [file, '-o', binary])
  exitCode = compiled === 0 ? run(binary, []) : compiled
} else if (language === 'java') {
  const compiled = run(javac, ['-encoding', 'UTF-8', '-d', directory, file])
  exitCode = compiled === 0 ? run(executable, ['-cp', directory, basename(file, '.java')]) : compiled
} else {
  exitCode = run(executable, [file])
}
process.exitCode = exitCode
