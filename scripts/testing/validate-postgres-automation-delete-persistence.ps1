param(
  [string]$PostgresImage = 'postgres:16-alpine',
  [string]$NodeImage = 'node:22-bookworm'
)

$ErrorActionPreference = 'Stop'
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$taskId = '20261020-055453-2a1c'
$suffix = [guid]::NewGuid().ToString('N').Substring(0, 10)
$databaseContainer = "wacrm-automation-delete-db-$suffix"
$nodeContainer = "wacrm-automation-delete-node-$suffix"
$bootstrapPassword = [guid]::NewGuid().ToString('N')
$runtimePassword = [guid]::NewGuid().ToString('N')
$fixturePath = Join-Path $repoRoot ".harness/tasks/$taskId/postgres-automation-delete-fixture.sql"
$repositoryPath = Join-Path $repoRoot 'src/lib/repositories/automation-delete-persistence.ts'
$integrationPath = Join-Path $repoRoot 'scripts/testing/postgres-automation-delete-persistence-integration.mjs'
$identityIntegrationPath = Join-Path $repoRoot 'scripts/testing/postgres-automation-delete-identity-integration.mjs'
$taskLog = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "../../.harness/tasks/$taskId/validation-postgres-automation-delete-$suffix.log"))
$validationSucceeded = $false
$primaryFailure = $null

function Invoke-DockerChecked {
  param([string[]]$Arguments)
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = & docker @Arguments 2>&1
    $code = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($code -ne 0) {
    $detail = @($output | ForEach-Object { $_.ToString() }) -join "`n"
    throw "docker $($Arguments[0]) failed with exit $code`n$detail"
  }
  return $output
}

try {
  $tokens = $null
  $parseErrors = $null
  [System.Management.Automation.Language.Parser]::ParseFile(
    $PSCommandPath,
    [ref]$tokens,
    [ref]$parseErrors
  ) | Out-Null
  if ($parseErrors.Count -gt 0) {
    throw "PowerShell AST parse failed: $($parseErrors -join '; ')"
  }

  $dockerContext = (& docker context show 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $dockerContext -ne 'desktop-linux') {
    throw "Expected Docker Desktop context 'desktop-linux'; received '$dockerContext'."
  }
  foreach ($image in @($PostgresImage, $NodeImage)) {
    & docker image inspect $image *> $null
    if ($LASTEXITCODE -ne 0) { throw "Required local image is not available: $image" }
  }

  $fixture = Get-Content -LiteralPath $fixturePath -Raw
  $repository = Get-Content -LiteralPath $repositoryPath -Raw
  if (-not (Test-Path -LiteralPath $identityIntegrationPath)) { throw 'Same-connection identity integration script is missing.' }
  $identityIntegration = Get-Content -LiteralPath $identityIntegrationPath -Raw
  foreach ($table in @(
    'accounts', 'profiles', 'automations', 'automation_steps',
    'automation_logs', 'automation_pending_executions'
  )) {
    if ($fixture -notmatch "ALTER TABLE public\.$table ENABLE ROW LEVEL SECURITY;\s*ALTER TABLE public\.$table FORCE ROW LEVEL SECURITY;") {
      throw "Fixture does not enable and force RLS on public.$table."
    }
  }
  if ($fixture -notmatch 'NOBYPASSRLS') { throw 'Fixture runtime role must set NOBYPASSRLS.' }
  if ($fixture -match 'GRANT (SELECT|INSERT|UPDATE|DELETE) ON TABLE public\.(accounts|profiles|automation_steps|automation_logs|automation_pending_executions)') {
    throw 'Fixture has an unexpected broad or child-table grant.'
  }
  foreach ($required in @(
    'GRANT SELECT \(id, user_id, account_id\), DELETE ON TABLE public\.automations',
    'GRANT SELECT \(id, name\) ON TABLE public\.accounts',
    'GRANT SELECT \(user_id, account_id, account_role\) ON TABLE public\.profiles'
  )) {
    if ($fixture -notmatch $required) { throw "Fixture is missing required grant: $required" }
  }
  foreach ($required in @(
    "requireRole\('agent'\)",
    'automation\.id = \$1',
    'automation\.user_id = \$2',
    'automation\.account_id = \$3',
    'profile\.user_id = automation\.user_id',
    'profile\.account_id = automation\.account_id',
    'RETURNING automation\.id::text AS id'
  )) {
    if ($repository -notmatch $required) { throw "Repository is missing required guard: $required" }
  }
  if (-not (Test-Path -LiteralPath $integrationPath)) { throw 'Integration script is missing.' }
  foreach ($required in @(
    "assert\.equal\(process\.env\.PG_POOL_MAX, '1'\)",
    'pg_backend_pid\(\)::int AS backend_pid',
    'backend_pid: beforePid, user_id: null'
  )) {
    if ($identityIntegration -notmatch $required) { throw "Same-connection identity probe is missing: $required" }
  }
  if (Test-Path -LiteralPath $taskLog) { throw "Refusing to overwrite existing validation log: $taskLog" }

  New-Item -ItemType File -Path $taskLog | Out-Null
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value @(
    "Docker context: $dockerContext",
    "Command: docker run --pull=never -d --rm --name $databaseContainer --network none --tmpfs /var/lib/postgresql/data:rw,nosuid,nodev,size=384m --mount <read-only-repository> $PostgresImage",
    'Disposable PostgreSQL image; tmpfs database; no ports or named volumes.',
    'Synthetic accounts, users, automations, steps, logs, and pending rows only. Generated credentials are not recorded.',
    'PowerShell AST, forced-RLS, NOBYPASSRLS, and minimum-grant checks passed.'
  )

  Invoke-DockerChecked @(
    'run', '--pull=never', '-d', '--rm', '--name', $databaseContainer, '--network', 'none',
    '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,nodev,size=384m',
    '--mount', "type=bind,source=$repoRoot,target=/repo,readonly",
    '-e', 'POSTGRES_USER=db_automation_delete_bootstrap',
    '-e', "POSTGRES_PASSWORD=$bootstrapPassword",
    '-e', 'POSTGRES_DB=postgres', $PostgresImage
  ) | Out-Null
  $postgresImageId = (& docker image inspect --format '{{.Id}}' $PostgresImage).Trim()
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value "Disposable PostgreSQL image ID: $postgresImageId"

  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    & docker exec $databaseContainer pg_isready -U db_automation_delete_bootstrap -d postgres *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'Disposable PostgreSQL did not become ready.' }

  Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', 'db_automation_delete_bootstrap', '-d', 'postgres', '-f',
    "/repo/.harness/tasks/$taskId/postgres-automation-delete-fixture.sql"
  ) | Out-Null
  Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', 'db_automation_delete_bootstrap', '-d', 'postgres', '-c',
    "ALTER ROLE wacrm_automation_delete_runtime PASSWORD '$runtimePassword'"
  ) | Out-Null

  $databaseUrl = "postgres://wacrm_automation_delete_runtime:$runtimePassword@127.0.0.1:5432/postgres"
  $nodeImageId = (& docker image inspect --format '{{.Id}}' $NodeImage).Trim()
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value @(
    "Command: docker run --pull=never --rm --name $nodeContainer --network container:$databaseContainer --mount type=bind,source=$repoRoot,target=/source,readonly --workdir /source -e DATABASE_URL=postgres://wacrm_automation_delete_runtime:<synthetic-generated>@127.0.0.1:5432/postgres -e PG_POOL_MAX=4 $NodeImage node --conditions=react-server --import ./scripts/testing/register-typescript-extensionless-loader.mjs --experimental-strip-types --experimental-default-type=module scripts/testing/postgres-automation-delete-persistence-integration.mjs",
    "Disposable Node image ID: $nodeImageId"
  )

  $nodeArgs = @(
    'run', '--pull=never', '--rm', '--name', $nodeContainer,
    '--network', "container:$databaseContainer",
    '--mount', "type=bind,source=$repoRoot,target=/source,readonly",
    '--workdir', '/source', '-e', "DATABASE_URL=$databaseUrl",
    '-e', 'TZ=Pacific/Kiritimati', '-e', 'PG_POOL_MAX=4',
    $NodeImage, 'node', '--conditions=react-server', '--import',
    './scripts/testing/register-typescript-extensionless-loader.mjs',
    '--experimental-strip-types', '--experimental-default-type=module',
    'scripts/testing/postgres-automation-delete-persistence-integration.mjs'
  )
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $nodeOutput = & docker @nodeArgs 2>&1
    $nodeExitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value "Node integration exit code: $nodeExitCode"
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value (@($nodeOutput | ForEach-Object { $_.ToString() }) -join "`n")
  if ($nodeExitCode -ne 0) { throw "Automation-delete PostgreSQL integration failed with exit $nodeExitCode." }

  $identityArgs = @(
    'run', '--pull=never', '--rm', '--name', $nodeContainer,
    '--network', "container:$databaseContainer",
    '--mount', "type=bind,source=$repoRoot,target=/source,readonly",
    '--workdir', '/source', '-e', "DATABASE_URL=$databaseUrl",
    '-e', 'TZ=Pacific/Kiritimati', '-e', 'PG_POOL_MAX=1',
    $NodeImage, 'node', '--conditions=react-server', '--import',
    './scripts/testing/register-typescript-extensionless-loader.mjs',
    '--experimental-strip-types', '--experimental-default-type=module',
    'scripts/testing/postgres-automation-delete-identity-integration.mjs'
  )
  try {
    $ErrorActionPreference = 'Continue'
    $identityOutput = & docker @identityArgs 2>&1
    $identityExitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = 'Stop'
  }
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value "Same-connection identity integration exit code: $identityExitCode"
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value (@($identityOutput | ForEach-Object { $_.ToString() }) -join "`n")
  if ($identityExitCode -ne 0) { throw "Same-connection identity cleanup proof failed with exit $identityExitCode." }

  $cascadeProbe = Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
    '-U', 'db_automation_delete_bootstrap', '-d', 'postgres', '-c',
    "SELECT (SELECT count(*) FROM public.automations)::text || ':' || (SELECT count(*) FROM public.automation_steps)::text || ':' || (SELECT count(*) FROM public.automation_logs)::text || ':' || (SELECT count(*) FROM public.automation_pending_executions)::text || ':' || (SELECT count(*) FROM public.automation_steps WHERE automation_id = '30000000-0000-4000-8000-000000000001')::text || ':' || (SELECT count(*) FROM public.automation_logs WHERE automation_id = '30000000-0000-4000-8000-000000000001')::text || ':' || (SELECT count(*) FROM public.automation_pending_executions WHERE automation_id = '30000000-0000-4000-8000-000000000001')::text || ':' || (SELECT count(*) FROM public.automations WHERE id IN ('30000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000006'))::text"
  )
  $cascadeCounts = (@($cascadeProbe | ForEach-Object { $_.ToString() }) -join '').Trim()
  if ($cascadeCounts -ne '4:2:2:1:0:0:0:4') {
    throw "Cascade/isolation post-probe expected 4:2:2:1:0:0:0:4; found $cascadeCounts."
  }
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value 'Bootstrap post-probe passed: automation deletion cascaded to steps, logs, and pending executions; unrelated owners/accounts remained intact.'
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value 'Only synthetic fixtures were queried; no provider/network calls occurred.'
  $validationSucceeded = $true
}
catch {
  $primaryFailure = $_.Exception.Message
  if (Test-Path -LiteralPath $taskLog) {
    Add-Content -LiteralPath $taskLog -Encoding utf8 -Value "Validation failure: $primaryFailure"
  }
}
finally {
  $ErrorActionPreference = 'Continue'
  $cleanupFailures = [System.Collections.Generic.List[string]]::new()
  foreach ($containerName in @($databaseContainer, $nodeContainer)) {
    $listedContainers = @(& docker ps -a --filter "name=$containerName" --format '{{.Names}}' 2>&1)
    $listExitCode = $LASTEXITCODE
    if ($listExitCode -ne 0) {
      $detail = @($listedContainers | ForEach-Object { $_.ToString() }) -join "`n"
      $cleanupFailures.Add("Could not inspect $containerName (exit $listExitCode): $detail")
      continue
    }
    if ($listedContainers -contains $containerName) {
      $removeOutput = @(& docker rm -f $containerName 2>&1)
      $removeExitCode = $LASTEXITCODE
      if ($removeExitCode -ne 0) {
        $detail = @($removeOutput | ForEach-Object { $_.ToString() }) -join "`n"
        $cleanupFailures.Add("Could not remove $containerName (exit $removeExitCode): $detail")
      }
    }
  }

  $residual = @(& docker ps -a --filter "name=$suffix" --format '{{.Names}}' 2>&1)
  $residualExitCode = $LASTEXITCODE
  if ($residualExitCode -ne 0) {
    $detail = @($residual | ForEach-Object { $_.ToString() }) -join "`n"
    $cleanupFailures.Add("Could not verify residual task containers (exit $residualExitCode): $detail")
  }
  elseif ($residual.Count -gt 0) {
    $cleanupFailures.Add("Residual task containers: $($residual -join ', ')")
  }

  $cleanup = if ($cleanupFailures.Count -eq 0) {
    'no residual task resources'
  } else {
    "cleanup failure: $($cleanupFailures -join '; ')"
  }
  if (Test-Path -LiteralPath $taskLog) {
    Add-Content -LiteralPath $taskLog -Encoding utf8 -Value "Cleanup: $cleanup"
  }
  if ($cleanupFailures.Count -gt 0) {
    $validationSucceeded = $false
    if ($primaryFailure) {
      $primaryFailure = "$primaryFailure; $cleanup"
    } else {
      $primaryFailure = $cleanup
    }
  }
}

if (-not $validationSucceeded) {
  if (Test-Path -LiteralPath $taskLog) {
    Add-Content -LiteralPath $taskLog -Encoding utf8 -Value 'Overall result: FAILURE'
  }
  Write-Error "PostgreSQL automation-delete validation failed: $primaryFailure"
  exit 1
}
Add-Content -LiteralPath $taskLog -Encoding utf8 -Value 'Overall result: SUCCESS'
Write-Output "SUCCESS: PostgreSQL automation-delete persistence integration; log $taskLog"
exit 0
