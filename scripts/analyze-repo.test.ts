import { describe, expect, it } from 'vitest'
import {
  parseCargoToml,
  parseGoMod,
  parseManifest,
  parsePackageJson,
  parsePomXml,
  parsePyprojectToml,
  parseRequirementsTxt,
} from './analyze-repo'

describe('parsePackageJson', () => {
  it('separa dependencies de devDependencies', () => {
    const content = JSON.stringify({
      dependencies: { react: '^18.3.1' },
      devDependencies: { vitest: '^2.1.8' },
    })
    const deps = parsePackageJson(content)
    expect(deps).toContainEqual({ name: 'react', version: '^18.3.1', type: 'prod' })
    expect(deps).toContainEqual({ name: 'vitest', version: '^2.1.8', type: 'dev' })
  })

  it('devuelve lista vacia sin dependencias declaradas', () => {
    expect(parsePackageJson('{}')).toEqual([])
  })
})

describe('parseRequirementsTxt', () => {
  it('parsea specs con operadores comunes e ignora comentarios', () => {
    const content = '# comentario\npandas==2.2.0\nrequests>=2.30\nnumpy\n-e .\n'
    const deps = parseRequirementsTxt(content)
    expect(deps).toEqual([
      { name: 'pandas', version: '==2.2.0', type: 'prod' },
      { name: 'requests', version: '>=2.30', type: 'prod' },
      { name: 'numpy', version: '', type: 'prod' },
    ])
  })
})

describe('parsePyprojectToml', () => {
  it('parsea dependencias estilo poetry con prod y dev separados', () => {
    const content = `
[tool.poetry.dependencies]
python = "^3.11"
fastapi = "^0.110.0"

[tool.poetry.group.dev.dependencies]
pytest = "^8.0.0"
`
    const deps = parsePyprojectToml(content)
    expect(deps).toContainEqual({ name: 'fastapi', version: '^0.110.0', type: 'prod' })
    expect(deps).toContainEqual({ name: 'pytest', version: '^8.0.0', type: 'dev' })
    expect(deps.find((d) => d.name === 'python')).toBeUndefined()
  })

  it('parsea dependencias estilo PEP621 (array de strings)', () => {
    const content = `
[project]
name = "demo"
dependencies = [
  "pandas>=2.2.0",
  "requests",
]
`
    const deps = parsePyprojectToml(content)
    expect(deps).toContainEqual({ name: 'pandas', version: '>=2.2.0', type: 'prod' })
    expect(deps).toContainEqual({ name: 'requests', version: '', type: 'prod' })
  })
})

describe('parsePomXml', () => {
  it('marca scope test como dev y el resto como prod', () => {
    const content = `
<project>
  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
      <version>3.2.0</version>
    </dependency>
    <dependency>
      <groupId>org.junit.jupiter</groupId>
      <artifactId>junit-jupiter</artifactId>
      <version>5.10.0</version>
      <scope>test</scope>
    </dependency>
  </dependencies>
</project>
`
    const deps = parsePomXml(content)
    expect(deps).toContainEqual({
      name: 'org.springframework.boot:spring-boot-starter-web',
      version: '3.2.0',
      type: 'prod',
    })
    expect(deps).toContainEqual({
      name: 'org.junit.jupiter:junit-jupiter',
      version: '5.10.0',
      type: 'dev',
    })
  })
})

describe('parseCargoToml', () => {
  it('separa [dependencies] de [dev-dependencies]', () => {
    const content = `
[package]
name = "demo"

[dependencies]
serde = "1.0"

[dev-dependencies]
criterion = "0.5"
`
    const deps = parseCargoToml(content)
    expect(deps).toContainEqual({ name: 'serde', version: '1.0', type: 'prod' })
    expect(deps).toContainEqual({ name: 'criterion', version: '0.5', type: 'dev' })
  })
})

describe('parseGoMod', () => {
  it('parsea bloque require y marca indirect como dev', () => {
    const content = `
module example.com/demo

go 1.22

require (
	github.com/gin-gonic/gin v1.9.1
	golang.org/x/sys v0.15.0 // indirect
)
`
    const deps = parseGoMod(content)
    expect(deps).toContainEqual({ name: 'github.com/gin-gonic/gin', version: 'v1.9.1', type: 'prod' })
    expect(deps).toContainEqual({ name: 'golang.org/x/sys', version: 'v0.15.0', type: 'dev' })
  })
})

describe('parseManifest (dispatcher)', () => {
  it('elige el parser correcto segun el nombre de archivo', () => {
    const deps = parseManifest('package.json', JSON.stringify({ dependencies: { zod: '^3.24.1' } }))
    expect(deps).toEqual([{ name: 'zod', version: '^3.24.1', type: 'prod' }])
  })

  it('devuelve lista vacia para manifiestos no reconocidos', () => {
    expect(parseManifest('archivo.raro', 'contenido')).toEqual([])
  })

  it('no lanza excepcion ante JSON invalido', () => {
    expect(parseManifest('package.json', '{ esto no es json')).toEqual([])
  })
})
