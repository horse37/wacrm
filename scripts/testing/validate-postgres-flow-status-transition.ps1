param(
  [string]$PostgresImage = 'postgres:16-alpine',
  [string]$NodeImage = 'node:22-bookworm'
)

$ErrorActionPreference = 'Stop'
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$taskId = '20261020-053426-5b29'
$suffix = [guid]::NewGuid().ToString('N').Substring(0, 10)
$databaseContainer = "wacrm-flow-status-db-$suffix"
$nodeContainer = "wacrm-flow-status-runtime-$suffix"
$bootstrapPassword = [guid]::NewGuid().ToString('N')
$runtimePassword = [guid]::NewGuid().ToString('N')
$fixturePath = Join-Path $repoRoot ".harness/tasks/$taskId/postgres-flow-status-fixture.sql"
$repositoryPath = Join-Path $repoRoot 'src/lib/repositories/flow-status-transition.ts'
$graphRepositoryPath = Join-Path $repoRoot 'src/lib/repositories/flow-node-graph-replace.ts'
$integrationPath = Join-Path $repoRoot 'scripts/testing/postgres-flow-status-transition-integration.mjs'
$taskLog = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "../../.harness/tasks/$taskId/validation-postgres-flow-status-$suffix.log"))
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
  $graphRepository = Get-Content -LiteralPath $graphRepositoryPath -Raw
  foreach ($table in @('accounts', 'profiles', 'flows', 'flow_nodes')) {
    if ($fixture -notmatch "ALTER TABLE public\.$table ENABLE ROW LEVEL SECURITY;\s*ALTER TABLE public\.$table FORCE ROW LEVEL SECURITY;") {
      throw "Fixture does not enable and force RLS on public.$table."
    }
  }
  if ($fixture -notmatch 'NOBYPASSRLS') { throw 'Fixture runtime role must set NOBYPASSRLS.' }
  if ($fixture -notmatch "'send_media'") { throw 'Fixture is missing the migration-supported send_media node type.' }
  if ($fixture -match 'GRANT (SELECT|INSERT|DELETE) ON TABLE public\.(accounts|profiles|flows)') {
    throw 'Fixture has an unexpected broad account/profile/flow grant.'
  }
  foreach ($required in @(
    'GRANT SELECT \(id, user_id, account_id, name, status, trigger_type, trigger_config, entry_node_id\)',
    'GRANT UPDATE \(status, updated_at\)',
    'GRANT SELECT \(flow_id, node_key, node_type, config\)',
    'GRANT DELETE ON TABLE public\.flow_nodes',
    'GRANT INSERT \(flow_id, node_key, node_type, config, position_x, position_y\)'
  )) {
    if ($fixture -notmatch $required) { throw "Fixture is missing required combined minimum grant: $required" }
  }
  foreach ($required in @(
    "requireRole\('agent'\)",
    'FOR UPDATE OF flow',
    'validateFlowForActivation',
    'status = \$3',
    'updated_at = NOW\(\)',
    'FROM public\.profiles AS creator',
    'flow\.account_id = \$2',
    'creator\.account_id = flow\.account_id',
    'ORDER BY node\.node_key ASC'
  )) {
    if ($repository -notmatch $required) { throw "Repository is missing required guard: $required" }
  }
  if ($graphRepository -notmatch 'pg_catalog\.pg_advisory_xact_lock' -or
      $graphRepository -notmatch 'pg_catalog\.hashtextextended\(\$1::text \|\| ''/'' \|\| \$2::text, 0\)') {
    throw 'Graph repository must take the shared account/flow transaction advisory lock.'
  }
  if ($repository -notmatch 'pg_catalog\.pg_advisory_xact_lock' -or
      $repository -notmatch 'pg_catalog\.hashtextextended\(\$1::text \|\| ''/'' \|\| \$2::text, 0\)') {
    throw 'Status repository must take the same account/flow transaction advisory lock.'
  }
  if ($fixture -notmatch 'pg_advisory_xact_lock\(20261020, 53426\)') {
    throw 'Fixture is missing the deterministic concurrent graph-replacement barrier.'
  }
  if (-not (Test-Path -LiteralPath $integrationPath)) { throw 'Integration script is missing.' }
  if (Test-Path -LiteralPath $taskLog) { throw "Refusing to overwrite existing validation log: $taskLog" }

  New-Item -ItemType File -Path $taskLog | Out-Null
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value @(
    "Docker context: $dockerContext",
    "Command: docker run --pull=never -d --rm --name $databaseContainer --network none --tmpfs /var/lib/postgresql/data:rw,nosuid,nodev,size=384m --mount <read-only-repository> $PostgresImage",
    'Disposable PostgreSQL 16 image; tmpfs database; no ports or named volumes.',
    'Synthetic accounts, profiles, flows, and flow nodes only. Generated credentials are not recorded.',
    'PowerShell AST, fixture forced-RLS, NOBYPASSRLS, and combined status/graph minimum-grant checks passed.'
  )

  Invoke-DockerChecked @(
    'run', '--pull=never', '-d', '--rm', '--name', $databaseContainer, '--network', 'none',
    '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,nodev,size=384m',
    '--mount', "type=bind,source=$repoRoot,target=/repo,readonly",
    '-e', 'POSTGRES_USER=db_flow_status_bootstrap',
    '-e', "POSTGRES_PASSWORD=$bootstrapPassword",
    '-e', 'POSTGRES_DB=postgres', $PostgresImage
  ) | Out-Null
  $postgresImageId = (& docker image inspect --format '{{.Id}}' $PostgresImage).Trim()
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value "Disposable PostgreSQL image ID: $postgresImageId"

  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    & docker exec $databaseContainer pg_isready -U db_flow_status_bootstrap -d postgres *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'Disposable PostgreSQL did not become ready.' }

  Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', 'db_flow_status_bootstrap', '-d', 'postgres', '-f',
    "/repo/.harness/tasks/$taskId/postgres-flow-status-fixture.sql"
  ) | Out-Null
  Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', 'db_flow_status_bootstrap', '-d', 'postgres', '-c',
    "ALTER ROLE wacrm_flow_status_runtime PASSWORD '$runtimePassword'"
  ) | Out-Null

  $databaseUrl = "postgres://wacrm_flow_status_runtime:$runtimePassword@127.0.0.1:5432/postgres"
  $nodeImageId = (& docker image inspect --format '{{.Id}}' $NodeImage).Trim()
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value @(
    "Command: docker run --pull=never --rm --name $nodeContainer --network container:$databaseContainer --mount type=bind,source=$repoRoot,target=/source,readonly --workdir /source -e DATABASE_URL=postgres://wacrm_flow_status_runtime:<synthetic-generated>@127.0.0.1:5432/postgres -e BOOTSTRAP_DATABASE_URL=postgres://db_flow_status_bootstrap:<synthetic-generated>@127.0.0.1:5432/postgres -e PG_POOL_MAX=4 $NodeImage node --conditions=react-server --import ./scripts/testing/register-typescript-extensionless-loader.mjs --experimental-strip-types --experimental-default-type=module scripts/testing/postgres-flow-status-transition-integration.mjs",
    "Disposable Node image ID: $nodeImageId"
  )

  $nodeArgs = @(
    'run', '--pull=never', '--rm', '--name', $nodeContainer,
    '--network', "container:$databaseContainer",
    '--mount', "type=bind,source=$repoRoot,target=/source,readonly",
    '--workdir', '/source', '-e', "DATABASE_URL=$databaseUrl",
    '-e', "BOOTSTRAP_DATABASE_URL=postgres://db_flow_status_bootstrap:$bootstrapPassword@127.0.0.1:5432/postgres",
    '-e', 'PG_POOL_MAX=4', $NodeImage, 'node', '--conditions=react-server', '--import',
    './scripts/testing/register-typescript-extensionless-loader.mjs',
    '--experimental-strip-types', '--experimental-default-type=module',
    'scripts/testing/postgres-flow-status-transition-integration.mjs'
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
  if ($nodeExitCode -ne 0) { throw "Flow status PostgreSQL integration failed with exit $nodeExitCode." }

  $postProbeSql = @"
SELECT CASE WHEN count(*) = 5
  AND count(*) FILTER (WHERE id = '70000000-0000-4000-8000-000000000001' AND status = 'active') = 1
  AND count(*) FILTER (WHERE id = '70000000-0000-4000-8000-000000000002' AND status = 'draft') = 1
  AND count(*) FILTER (WHERE id = '70000000-0000-4000-8000-000000000003' AND status = 'active') = 1
  AND count(*) FILTER (WHERE id = '70000000-0000-4000-8000-000000000004' AND status = 'draft') = 1
  AND count(*) FILTER (WHERE id = '70000000-0000-4000-8000-000000000005' AND status = 'draft') = 1
  THEN 'PASS' ELSE 'FAIL' END
FROM public.flows
UNION ALL
SELECT CASE WHEN count(*) = 9 THEN 'PASS' ELSE 'FAIL' END
FROM public.flow_nodes
ORDER BY 1
"@
  $postProbe = Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
    '-U', 'db_flow_status_bootstrap', '-d', 'postgres', '-c', $postProbeSql
  )
  $postProbeResults = @($postProbe | ForEach-Object { $_.ToString().Trim() } | Where-Object { $_ })
  if (($postProbeResults -join ',') -ne 'PASS,PASS') {
    throw "Bootstrap flow status post-probe failed: $($postProbeResults -join ',')"
  }
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value 'Bootstrap post-probe passed: valid activation, blocked activation, warning-only activation, unconditional draft/archive, serialized graph replacement/activation, account isolation, and unchanged non-race nodes were verified.'
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value 'Only synthetic fixtures were queried; no app/provider/network calls occurred.'
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
  Write-Error "PostgreSQL flow status validation failed: $primaryFailure"
  exit 1
}
Add-Content -LiteralPath $taskLog -Encoding utf8 -Value 'Overall result: SUCCESS'
Write-Output "SUCCESS: PostgreSQL flow status integration; log $taskLog"
exit 0
