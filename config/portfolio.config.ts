export interface PortfolioConfig {
  githubUsername: string
  includeForks: boolean
  exclude: string[]
  edgeWeights: {
    lenguaje: number
    dependencias: number
    topics: number
    dominio: number
    mencionCruzada: number
  }
  edgeThreshold: number
  stopwordDependencies: string[]
  inactivityThresholdDays: number
}

export const portfolioConfig: PortfolioConfig = {
  githubUsername: 'VelazPedro',
  includeForks: false,
  exclude: [],
  edgeWeights: {
    lenguaje: 0.2,
    dependencias: 0.35,
    topics: 0.25,
    dominio: 0.1,
    mencionCruzada: 0.1,
  },
  edgeThreshold: 0.25,
  stopwordDependencies: [
    'react',
    'typescript',
    'vite',
    'eslint',
    'prettier',
    '@types/node',
    '@types/react',
  ],
  inactivityThresholdDays: 548,
}
