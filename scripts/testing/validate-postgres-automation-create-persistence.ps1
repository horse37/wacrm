param(
  [string]$PostgresImage = 'postgres:16-alpine',
  [string]$NodeImage = 'node:22-bookworm'
)

$ErrorActionPreference = 'Stop'
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$taskId = '20261020-062203-ae91'
$suffix = [guid]::NewGuid().ToString('N').Substring(0, 10)
$databaseContainer = "wacrm-automation-create-db-$suffix"
$nodeContainer = "wacrm-automation-create-node-$suffix"
$bootstrapPassword = [guid]::NewGuid().ToString('N')
$runtimePassword = [guid]::NewGuid().ToString('N')
$fixturePath = Join-Path $repoRoot ".harness/tasks/$taskId/postgres-automation-create-fixture.sql"
$repositoryPath = Join-Path $repoRoot 'src/lib/repositories/automation-create-persistence.ts'
$integrationPath = Join-Path $repoRoot 'scripts/testing/postgres-automation-create-persistence-integration.mjs'
$identityIntegrationPath = Join-Path $repoRoot 'scripts/testing/postgres-automation-create-identity-integration.mjs'
$taskLog = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "../../.harness/tasks/$taskId/validation-postgres-automation-create-$suffix.log"))
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

function Invoke-NodeIntegration {
  param(
    [string]$ScriptName,
    [string]$PoolMax,
    [string]$Label
  )

  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value "Command: docker run --pull=never --rm --name $nodeContainer --network container:$databaseContainer --mount type=bind,source=$repoRoot,target=/source,readonly --workdir /source -e DATABASE_URL=postgres://wacrm_automation_create_runtime:<synthetic-generated>@127.0.0.1:5432/postgres -e PG_POOL_MAX=$PoolMax $NodeImage node --conditions=react-server --import ./scripts/testing/register-typescript-extensionless-loader.mjs --experimental-strip-types --experimental-default-type=module scripts/testing/$ScriptName"

  $nodeArgs = @(
    'run', '--pull=never', '--rm', '--name', $nodeContainer,
    '--network', "container:$databaseContainer",
    '--mount', "type=bind,source=$repoRoot,target=/source,readonly",
    '--workdir', '/source', '-e', "DATABASE_URL=$databaseUrl",
    '-e', 'TZ=Pacific/Kiritimati', '-e', "PG_POOL_MAX=$PoolMax",
    $NodeImage, 'node', '--conditions=react-server', '--import',
    './scripts/testing/register-typescript-extensionless-loader.mjs',
    '--experimental-strip-types', '--experimental-default-type=module',
    "scripts/testing/$ScriptName"
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
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value "$Label exit code: $nodeExitCode"
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value (@($nodeOutput | ForEach-Object { $_.ToString() }) -join "`n")
  if ($nodeExitCode -ne 0) { throw "$Label failed with exit $nodeExitCode." }
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
  if (-not (Test-Path -LiteralPath $integrationPath)) { throw 'Main integration script is missing.' }
  if (-not (Test-Path -LiteralPath $identityIntegrationPath)) { throw 'Same-connection identity integration script is missing.' }

  foreach ($table in @('accounts', 'profiles', 'automations', 'automation_steps')) {
    if ($fixture -notmatch "ALTER TABLE public\.$table ENABLE ROW LEVEL SECURITY;\s*ALTER TABLE public\.$table FORCE ROW LEVEL SECURITY;") {
      throw "Fixture does not enable and force RLS on public.$table."
    }
  }
  if ($fixture -notmatch 'NOBYPASSRLS') { throw 'Fixture runtime role must set NOBYPASSRLS.' }
  if ($fixture -match 'GRANT (SELECT|INSERT|UPDATE|DELETE) ON TABLE public\.(accounts|profiles|automation_steps|automations)') {
    throw 'Fixture contains an unexpected broad table grant.'
  }
  foreach ($required in @(
    'GRANT SELECT \(id, name\) ON TABLE public\.accounts',
    'GRANT SELECT \(user_id, account_id, account_role\) ON TABLE public\.profiles',
    'GRANT SELECT \(\s*id, user_id, account_id, name, description, trigger_type, trigger_config,\s*is_active, execution_count, last_executed_at, created_at, updated_at\s*\) ON TABLE public\.automations',
    'GRANT INSERT \(\s*id, user_id, account_id, name, description, trigger_type, trigger_config,\s*is_active\s*\) ON TABLE public\.automations',
    'GRANT SELECT \(id, automation_id, parent_step_id, branch, step_type, step_config, position\)\s*ON TABLE public\.automation_steps',
    'GRANT INSERT \(\s*id, automation_id, parent_step_id, branch, step_type, step_config, position\s*\) ON TABLE public\.automation_steps'
  )) {
    if ($fixture -notmatch $required) { throw "Fixture is missing required minimum grant: $required" }
  }
  foreach ($required in @(
    "requireRole\('agent'\)",
    'SELECT set_config\(''request\.jwt\.claim\.sub'', \$1, true\)',
    'validateTriggerForActivation',
    'validateStepsForActivation',
    'INSERT INTO public\.automations',
    'jsonb_to_recordset\(\$1::jsonb\)',
    'maxAutomationSteps',
    'maxAutomationDepth'
  )) {
    if ($repository -notmatch $required) { throw "Repository is missing required guard: $required" }
  }
  if (Test-Path -LiteralPath $taskLog) { throw "Refusing to overwrite existing validation log: $taskLog" }

  New-Item -ItemType File -Path $taskLog | Out-Null
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value @(
    "Docker context: $dockerContext",
    "Command: docker run --pull=never -d --rm --name $databaseContainer --network none --tmpfs /var/lib/postgresql/data:rw,nosuid,nodev,size=384m --mount <read-only-repository> $PostgresImage",
    'Disposable PostgreSQL image; tmpfs database; no ports or named volumes.',
    'Synthetic accounts, users, automations, and steps only. Generated credentials are not recorded.',
    'PowerShell AST, forced-RLS, NOBYPASSRLS, and minimum-grant checks passed.'
  )

  Invoke-DockerChecked @(
    'run', '--pull=never', '-d', '--rm', '--name', $databaseContainer, '--network', 'none',
    '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,nodev,size=384m',
    '--mount', "type=bind,source=$repoRoot,target=/repo,readonly",
    '-e', 'POSTGRES_USER=db_automation_create_bootstrap',
    '-e', "POSTGRES_PASSWORD=$bootstrapPassword",
    '-e', 'POSTGRES_DB=postgres', $PostgresImage
  ) | Out-Null
  $postgresImageId = (& docker image inspect --format '{{.Id}}' $PostgresImage).Trim()
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value "Disposable PostgreSQL image ID: $postgresImageId"

  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    & docker exec $databaseContainer pg_isready -U db_automation_create_bootstrap -d postgres *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'Disposable PostgreSQL did not become ready.' }

  Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', 'db_automation_create_bootstrap', '-d', 'postgres', '-f',
    "/repo/.harness/tasks/$taskId/postgres-automation-create-fixture.sql"
  ) | Out-Null
  Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', 'db_automation_create_bootstrap', '-d', 'postgres', '-c',
    "ALTER ROLE wacrm_automation_create_runtime PASSWORD '$runtimePassword'"
  ) | Out-Null

  $databaseUrl = "postgres://wacrm_automation_create_runtime:$runtimePassword@127.0.0.1:5432/postgres"
  $nodeImageId = (& docker image inspect --format '{{.Id}}' $NodeImage).Trim()
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value "Disposable Node image ID: $nodeImageId"
  Invoke-NodeIntegration -ScriptName 'postgres-automation-create-persistence-integration.mjs' -PoolMax '4' -Label 'Main automation-create integration'
  Invoke-NodeIntegration -ScriptName 'postgres-automation-create-identity-integration.mjs' -PoolMax '1' -Label 'Same-connection identity integration'

  $postProbe = Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
    '-U', 'db_automation_create_bootstrap', '-d', 'postgres', '-c',
    "SELECT (SELECT count(*) FROM public.automations)::text || ':' || (SELECT count(*) FROM public.automation_steps)::text || ':' || (SELECT count(*) FROM public.automations WHERE is_active)::text || ':' || (SELECT count(*) FROM public.automations WHERE name = 'Synthetic empty draft' AND NOT is_active AND trigger_config = '{}'::jsonb)::text || ':' || (SELECT count(*) FROM public.automations WHERE name = 'Synthetic rollback')::text || ':' || (SELECT count(*) FROM public.automation_steps WHERE automation_id = (SELECT id FROM public.automations WHERE name = 'Synthetic identity creation'))::text"
  )
  $postCounts = (@($postProbe | ForEach-Object { $_.ToString() }) -join '').Trim()
  if ($postCounts -ne '4:5:2:1:0:1') {
    throw "Post-probe expected 4:5:2:1:0:1; found $postCounts."
  }
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value 'Bootstrap post-probe passed: two active automation/step trees and two drafts persisted, rollback left no parent, identity creation persisted, and all step counts matched.'
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
  Write-Error "PostgreSQL automation-create validation failed: $primaryFailure"
  exit 1
}
Add-Content -LiteralPath $taskLog -Encoding utf8 -Value 'Overall result: SUCCESS'
Write-Output "SUCCESS: PostgreSQL automation-create persistence integration; log $taskLog"
exit 0
