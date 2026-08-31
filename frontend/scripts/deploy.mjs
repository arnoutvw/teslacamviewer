import { cpSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const dist = join(here, '..', 'dist')
const target = join(here, '..', '..', 'backend', 'src', 'main', 'resources', 'static')
rmSync(target, { recursive: true, force: true })
cpSync(dist, target, { recursive: true })
writeFileSync(join(target, '.gitignore'), '*\n!.gitignore\n')
console.log(`copied ${dist} -> ${target}`)