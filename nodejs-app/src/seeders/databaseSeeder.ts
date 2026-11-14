import { syncPermissions } from '../authorization/permissionSynchronizer.ts'
import { isProduction } from '../config/index.ts'
import { runDemoTenantSeeder } from './demoTenantSeeder.ts'

export async function runDatabaseSeeder(): Promise<void> {
  // Required in every environment: the permission catalogue
  await syncPermissions()

  if (!isProduction()) await runDemoTenantSeeder()
}
