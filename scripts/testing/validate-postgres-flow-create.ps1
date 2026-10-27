param(
  [string]$PostgresImage = 'postgres:16-alpine',
  [string]$NodeImage = 'node:22-bookworm'
)

$ErrorActionPreference = 'Stop'
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$taskId = '20261020-052532-c1b8'
$suffix = [guid]::NewGuid().ToString('N').Substring(0, 10)
$databaseContainer = "wacrm-flow-create-db-$suffix"
$nodeContainer = "wacrm-flow-create-runtime-$suffix"
$bootstrapPassword = [guid]::NewGuid().ToString('N')
$runtimePassword = [guid]::NewGuid().ToString('N')
$fixturePath = Join-Path $repoRoot ".harness/tasks/$taskId/postgres-flow-create-fixture.sql"
$repositoryPath = Join-Path $repoRoot 'src/lib/repositories/flow-create-persistence.ts'
$integrationPath = Join-Path $repoRoot 'scripts/testing/postgres-flow-create-integration.mjs'
$taskLog = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "../../.harness/tasks/$taskId/validation-postgres-flow-create-$suffix.log"))
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
    'GRANT SELECT \(id, account_id\) ON TABLE public\.flows',
    'GRANT INSERT \(user_id, account_id, name, description, status, trigger_type, trigger_config, entry_node_id, fallback_policy\)',
    'GRANT SELECT \(flow_id, node_key, node_type, config, position_x, position_y\)',
    'GRANT INSERT \(flow_id, node_key, node_type, config, position_x, position_y\)'
  )) {
    if ($fixture -notmatch $required) { throw "Fixture is missing required minimum grant: $required" }
  }
  foreach ($required in @(
    "requireRole\('agent'\)",
    'INSERT INTO public\.flows',
    'FROM public\.profiles AS creator',
    'creator\.user_id = \$1',
    'creator\.account_id = \$2',
    'INSERT INTO public\.flow_nodes'
  )) {
    if ($repository -notmatch $required) { throw "Repository is missing required guard: $required" }
  }
  if (-not (Test-Path -LiteralPath $integrationPath)) { throw 'Integration script is missing.' }
  if (Test-Path -LiteralPath $taskLog) { throw "Refusing to overwrite existing validation log: $taskLog" }

  New-Item -ItemType File -Path $taskLog | Out-Null
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value @(
    "Docker context: $dockerContext",
    "Command: docker run --pull=never -d --rm --name $databaseContainer --network none --tmpfs /var/lib/postgresql/data:rw,nosuid,nodev,size=384m --mount <read-only-repository> $PostgresImage",
    'Disposable PostgreSQL 16 image; tmpfs database; no ports or named volumes.',
    'Synthetic accounts, profiles, flow drafts, and template nodes only. Generated credentials are not recorded.',
    'PowerShell AST, fixture forced-RLS, NOBYPASSRLS, and minimum-grant checks passed.'
  )

  Invoke-DockerChecked @(
    'run', '--pull=never', '-d', '--rm', '--name', $databaseContainer, '--network', 'none',
    '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,nodev,size=384m',
    '--mount', "type=bind,source=$repoRoot,target=/repo,readonly",
    '-e', 'POSTGRES_USER=db_flow_create_bootstrap',
    '-e', "POSTGRES_PASSWORD=$bootstrapPassword",
    '-e', 'POSTGRES_DB=postgres', $PostgresImage
  ) | Out-Null
  $postgresImageId = (& docker image inspect --format '{{.Id}}' $PostgresImage).Trim()
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value "Disposable PostgreSQL image ID: $postgresImageId"

  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    & docker exec $databaseContainer pg_isready -U db_flow_create_bootstrap -d postgres *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'Disposable PostgreSQL did not become ready.' }

  Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', 'db_flow_create_bootstrap', '-d', 'postgres', '-f',
    "/repo/.harness/tasks/$taskId/postgres-flow-create-fixture.sql"
  ) | Out-Null
  Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', 'db_flow_create_bootstrap', '-d', 'postgres', '-c',
    "ALTER ROLE wacrm_flow_create_runtime PASSWORD '$runtimePassword'"
  ) | Out-Null

  $databaseUrl = "postgres://wacrm_flow_create_runtime:$runtimePassword@127.0.0.1:5432/postgres"
  $nodeImageId = (& docker image inspect --format '{{.Id}}' $NodeImage).Trim()
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value @(
    "Command: docker run --pull=never --rm --name $nodeContainer --network container:$databaseContainer --mount type=bind,source=$repoRoot,target=/source,readonly --workdir /source -e DATABASE_URL=postgres://wacrm_flow_create_runtime:<synthetic-generated>@127.0.0.1:5432/postgres -e PG_POOL_MAX=4 $NodeImage node --conditions=react-server --import ./scripts/testing/register-typescript-extensionless-loader.mjs --experimental-strip-types --experimental-default-type=module scripts/testing/postgres-flow-create-integration.mjs",
    "Disposable Node image ID: $nodeImageId"
  )

  $nodeArgs = @(
    'run', '--pull=never', '--rm', '--name', $nodeContainer,
    '--network', "container:$databaseContainer",
    '--mount', "type=bind,source=$repoRoot,target=/source,readonly",
    '--workdir', '/source', '-e', "DATABASE_URL=$databaseUrl",
    '-e', 'PG_POOL_MAX=4', $NodeImage, 'node', '--conditions=react-server', '--import',
    './scripts/testing/register-typescript-extensionless-loader.mjs',
    '--experimental-strip-types', '--experimental-default-type=module',
    'scripts/testing/postgres-flow-create-integration.mjs'
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
  if ($nodeExitCode -ne 0) { throw "Flow-node graph PostgreSQL integration failed with exit $nodeExitCode." }

  $postProbeSql = @"
SELECT CASE WHEN count(*) = 3
  AND count(*) FILTER (WHERE flow.name = 'Synthetic plain draft'
    AND flow.status = 'draft' AND flow.trigger_type = 'keyword'
    AND flow.trigger_config = '{}'::jsonb AND flow.entry_node_id IS NULL
    AND flow.fallback_policy = '{"on_unknown_reply":"reprompt","max_reprompts":2,"on_timeout_hours":24,"on_exhaust":"handoff"}'::jsonb
    AND flow.user_id = '00000000-0000-4000-8000-000000000002'
    AND flow.account_id = '10000000-0000-4000-8000-000000000001'
    AND (SELECT count(*) FROM public.flow_nodes n WHERE n.flow_id = flow.id) = 0) = 1
  AND count(*) FILTER (WHERE flow.name = 'Synthetic template clone'
    AND flow.description = 'Synthetic only' AND flow.status = 'draft'
    AND flow.trigger_type = 'manual'
    AND flow.trigger_config = '{"marker":"synthetic"}'::jsonb
    AND flow.entry_node_id = 'start'
    AND flow.fallback_policy = '{"on_unknown_reply":"handoff"}'::jsonb
    AND flow.user_id = '00000000-0000-4000-8000-000000000002'
    AND flow.account_id = '10000000-0000-4000-8000-000000000001'
    AND (SELECT count(*) FROM public.flow_nodes n WHERE n.flow_id = flow.id) = 3) = 1
  AND count(*) FILTER (WHERE flow.name = 'Synthetic account B draft'
    AND flow.status = 'draft'
    AND flow.user_id = '00000000-0000-4000-8000-000000000004'
    AND flow.account_id = '10000000-0000-4000-8000-000000000002'
    AND (SELECT count(*) FROM public.flow_nodes n WHERE n.flow_id = flow.id) = 0) = 1
  THEN 'PASS' ELSE 'FAIL' END
FROM public.flows AS flow
UNION ALL
SELECT CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM public.flows AS flow WHERE flow.name = 'Synthetic rollback draft'
UNION ALL
SELECT CASE WHEN count(*) = 3
  AND count(*) FILTER (WHERE node_key = 'start' AND node_type = 'start'
    AND config = '{"next_node_key":"media"}'::jsonb
    AND position_x = -15 AND position_y = 25) = 1
  AND count(*) FILTER (WHERE node_key = 'media' AND node_type = 'send_media'
    AND config = '{"media_type":"image","media_url":"https://example.invalid/synthetic.png","next_node_key":"end"}'::jsonb
    AND position_x = 0 AND position_y = 0) = 1
  AND count(*) FILTER (WHERE node_key = 'end' AND node_type = 'end'
    AND config = '{}'::jsonb AND position_x = 0 AND position_y = 0) = 1
  THEN 'PASS' ELSE 'FAIL' END
FROM public.flow_nodes AS node
INNER JOIN public.flows AS flow ON flow.id = node.flow_id
WHERE flow.name = 'Synthetic template clone'
ORDER BY 1
"@
  $postProbe = Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
    '-U', 'db_flow_create_bootstrap', '-d', 'postgres', '-c', $postProbeSql
  )
  $postProbeResults = @($postProbe | ForEach-Object { $_.ToString().Trim() } | Where-Object { $_ })
  if (($postProbeResults -join ',') -ne 'PASS,PASS,PASS') {
    throw "Bootstrap flow creation post-probe failed: $($postProbeResults -join ',')"
  }
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value 'Bootstrap post-probe passed: plain and template drafts, default and explicit metadata, template graph, account ownership, draft status, and rollback were verified.'
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
  Write-Error "PostgreSQL flow creation validation failed: $primaryFailure"
  exit 1
}
Add-Content -LiteralPath $taskLog -Encoding utf8 -Value 'Overall result: SUCCESS'
Write-Output "SUCCESS: PostgreSQL flow creation integration; log $taskLog"
exit 0
