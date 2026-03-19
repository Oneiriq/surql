export {
  configureEnvironments,
  type EnvironmentConfig,
  EnvironmentRegistry,
  getEnvironmentRegistry,
  registerEnvironment,
  setEnvironmentRegistry,
} from './config.ts'
export { type DeploymentPlan, deployToEnvironments, MigrationCoordinator, OrchestrationError } from './coordinator.ts'
export { checkEnvironmentHealth, type HealthCheck, type HealthStatus, verifyConnectivity } from './health.ts'
export {
  canaryDeploy,
  type DeployFn,
  type DeploymentResult,
  DeploymentStatus,
  parallelDeploy,
  rollingDeploy,
  sequentialDeploy,
} from './strategy.ts'
