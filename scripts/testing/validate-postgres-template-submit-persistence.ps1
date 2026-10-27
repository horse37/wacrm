param(
  [string]$PostgresImage = 'postgres:16-alpine',
  [string]$NodeImage = 'node:22-bookworm',
  [string]$TaskId = '20261020-035839-2f1e'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$suffix = [guid]::NewGuid().ToString('N').Substring(0, 10)
$databaseContainer = "wacrm-template-submit-db-$suffix"
$nodeContainer = "wacrm-template-submit-node-$suffix"
$bootstrapPassword = [guid]::NewGuid().ToString('N')
$runtimePassword = [guid]::NewGuid().ToString('N')
$fixturePath = Join-Path $repoRoot ".harness/tasks/$taskId/postgres-template-submit-persistence-fixture.sql"
$integrationPath = Join-Path $repoRoot 'scripts/testing/postgres-template-submit-persistence-integration.mjs'
$taskLog = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "../../.harness/tasks/$taskId/validation-postgres-template-submit-persistence-$suffix.log"))
if (Test-Path -LiteralPath $taskLog) { throw "Refusing to overwrite existing validation log: $taskLog" }
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
  foreach ($table in @('accounts', 'profiles', 'message_templates')) {
    if ($fixture -notmatch "ALTER TABLE public\.$table ENABLE ROW LEVEL SECURITY;\s*ALTER TABLE public\.$table FORCE ROW LEVEL SECURITY;") {
      throw "Fixture does not enable and force RLS on public.$table."
    }
  }
  if ($fixture -notmatch 'NOBYPASSRLS') { throw 'Fixture runtime role must set NOBYPASSRLS.' }
  if ($fixture -match 'GRANT (SELECT|INSERT|UPDATE) ON TABLE public\.message_templates') {
    throw 'Fixture must grant template access by column, not by table.'
  }
  if ($fixture -match 'GRANT SELECT ON TABLE public\.(accounts|profiles)') {
    throw 'Fixture must grant account/profile reads by column.'
  }
  if ($fixture -notmatch 'UNIQUE \(user_id, name, language\)') {
    throw 'Fixture must preserve the legacy per-user unique key.'
  }
  foreach ($required in @(
    'GRANT SELECT \(id, name\)\s+ON TABLE public\.accounts',
    'GRANT SELECT \(user_id, account_id, account_role\)\s+ON TABLE public\.profiles',
    'GRANT SELECT \(\s*id, user_id, account_id, name, language, created_at, updated_at, quality_score\s*\)\s+ON TABLE public\.message_templates',
    'GRANT INSERT \([\s\S]*?last_submitted_at\s*\) ON TABLE public\.message_templates',
    'GRANT UPDATE \([\s\S]*?last_submitted_at\s*\) ON TABLE public\.message_templates'
  )) {
    if ($fixture -notmatch $required) { throw "Fixture is missing required grant: $required" }
  }
  if ($fixture -match 'GRANT SELECT \([^)]*(header_media_url|header_handle|submission_error|rejection_reason|meta_template_id|sample_values)') {
    throw 'Runtime SELECT grants must omit media, upload, provider, and template-content internals.'
  }
  if ($fixture -notmatch 'GRANT (INSERT|UPDATE) \([\s\S]*?header_media_url') {
    throw 'Runtime must be able to persist the submitted header_media_url.'
  }
  if (-not (Test-Path -LiteralPath $integrationPath)) { throw 'Integration script is missing.' }

  New-Item -ItemType File -Path $taskLog | Out-Null
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value @(
    "Docker context: $dockerContext",
    "Command: docker run --pull=never -d --rm --name $databaseContainer --network none --tmpfs /var/lib/postgresql/data:rw,nosuid,nodev,size=384m -e POSTGRES_USER=db_template_submit_bootstrap -e POSTGRES_PASSWORD=<synthetic-generated> -e POSTGRES_DB=postgres --mount <read-only-repository> $PostgresImage",
    "Disposable PostgreSQL image: $PostgresImage; database is tmpfs; no published ports or named volumes.",
    'Synthetic users, accounts, profiles, and templates only. Bootstrap and runtime passwords are generated for this run and are not recorded.',
    'PowerShell AST and fixture minimum-grant/forced-RLS/per-user-unique checks passed.'
  )

  Invoke-DockerChecked @(
    'run', '--pull=never', '-d', '--rm', '--name', $databaseContainer, '--network', 'none',
    '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,nodev,size=384m',
    '--mount', "type=bind,source=$repoRoot,target=/repo,readonly",
    '-e', 'POSTGRES_USER=db_template_submit_bootstrap',
    '-e', "POSTGRES_PASSWORD=$bootstrapPassword",
    '-e', 'POSTGRES_DB=postgres', $PostgresImage
  ) | Out-Null
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value "Disposable PostgreSQL image ID: $(& docker image inspect --format '{{.Id}}' $PostgresImage)"

  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    & docker exec $databaseContainer pg_isready -U db_template_submit_bootstrap -d postgres *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'Disposable PostgreSQL did not become ready.' }

  Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', 'db_template_submit_bootstrap', '-d', 'postgres', '-f',
    "/repo/.harness/tasks/$taskId/postgres-template-submit-persistence-fixture.sql"
  ) | Out-Null
  Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', 'db_template_submit_bootstrap', '-d', 'postgres', '-c',
    "ALTER ROLE wacrm_template_submit_runtime PASSWORD '$runtimePassword'"
  ) | Out-Null

  $databaseUrl = "postgres://wacrm_template_submit_runtime:$runtimePassword@127.0.0.1:5432/postgres"
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value @(
    "Command: docker run --pull=never --rm --name $nodeContainer --network container:$databaseContainer --mount type=bind,source=$repoRoot,target=/source,readonly --workdir /source -e DATABASE_URL=postgres://wacrm_template_submit_runtime:<synthetic-generated>@127.0.0.1:5432/postgres -e PG_POOL_MAX=4 $NodeImage node --conditions=react-server --import ./scripts/testing/register-typescript-extensionless-loader.mjs --experimental-strip-types --experimental-default-type=module scripts/testing/postgres-template-submit-persistence-integration.mjs",
    "Disposable Node image ID: $(& docker image inspect --format '{{.Id}}' $NodeImage)"
  )

  $nodeArgs = @(
    'run', '--pull=never', '--rm', '--name', $nodeContainer,
    '--network', "container:$databaseContainer",
    '--mount', "type=bind,source=$repoRoot,target=/source,readonly",
    '--workdir', '/source', '-e', "DATABASE_URL=$databaseUrl",
    '-e', 'TZ=Pacific/Kiritimati',
    '-e', 'PG_POOL_MAX=4',
    $NodeImage, 'node', '--conditions=react-server', '--import',
    './scripts/testing/register-typescript-extensionless-loader.mjs',
    '--experimental-strip-types', '--experimental-default-type=module',
    'scripts/testing/postgres-template-submit-persistence-integration.mjs'
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
  if ($nodeExitCode -ne 0) { throw "PostgreSQL template-submit persistence integration failed with exit $nodeExitCode." }

  $ownerProbe = Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
    '-U', 'db_template_submit_bootstrap', '-d', 'postgres', '-c',
    "SELECT (header_media_url = 'https://synthetic.invalid/new.png' AND account_id = '10000000-0000-4000-8000-000000000001'::uuid AND user_id = '00000000-0000-4000-8000-000000000001'::uuid AND body_text = 'Sua visita é às {{1}}.' AND status = 'PENDING' AND meta_template_id = 'SYNTHETIC_META_TEMPLATE_ID' AND submission_error IS NULL AND rejection_reason IS NULL AND last_submitted_at = '2026-10-20T12:00:00Z'::timestamptz AND updated_at > '2000-01-01'::timestamptz)::int FROM public.message_templates WHERE id = '30000000-0000-4000-8000-000000000019'"
  )
  $ownerValue = (@($ownerProbe | ForEach-Object { $_.ToString() }) -join '').Trim()
  if ($ownerValue -ne '1') { throw "Successful submission update probe failed: $ownerValue" }

  $adminProbe = Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
    '-U', 'db_template_submit_bootstrap', '-d', 'postgres', '-c',
    "SELECT (header_media_url = 'https://synthetic.invalid/new.png' AND status = 'DRAFT' AND meta_template_id IS NULL AND submission_error = 'Synthetic provider rejection' AND rejection_reason IS NULL AND last_submitted_at = '2026-10-20T12:00:00Z'::timestamptz AND updated_at > '2000-01-01'::timestamptz)::int FROM public.message_templates WHERE id = '30000000-0000-4000-8000-000000000020'"
  )
  $adminValue = (@($adminProbe | ForEach-Object { $_.ToString() }) -join '').Trim()
  if ($adminValue -ne '1') { throw "Failed submission update probe failed: $adminValue" }

  $perUserProbe = Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
    '-U', 'db_template_submit_bootstrap', '-d', 'postgres', '-c',
    "SELECT count(*)::text FROM public.message_templates WHERE account_id = '10000000-0000-4000-8000-000000000001' AND name = 'appointment_reminder' AND language = 'pt_BR'"
  )
  $perUserValue = (@($perUserProbe | ForEach-Object { $_.ToString() }) -join '').Trim()
  if ($perUserValue -ne '2') { throw "Per-user same-name uniqueness probe failed: $perUserValue" }

  $concurrencyProbe = Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
    '-U', 'db_template_submit_bootstrap', '-d', 'postgres', '-c',
    "SELECT count(*)::text || '|' || (array_agg(user_id))[1]::text FROM public.message_templates WHERE account_id = '10000000-0000-4000-8000-000000000001' AND name = 'concurrent_submit' AND language = 'pt_BR'"
  )
  $concurrencyValue = (@($concurrencyProbe | ForEach-Object { $_.ToString() }) -join '').Trim()
  if ($concurrencyValue -ne '1|00000000-0000-4000-8000-000000000001') {
    throw "Concurrent upsert uniqueness probe failed: $concurrencyValue"
  }

  $accountProbe = Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
    '-U', 'db_template_submit_bootstrap', '-d', 'postgres', '-c',
    "SELECT count(*) FILTER (WHERE account_id = '10000000-0000-4000-8000-000000000001')::text || '|' || count(*) FILTER (WHERE account_id = '10000000-0000-4000-8000-000000000002')::text FROM public.message_templates WHERE name = 'account_b_only' AND language = 'pt_BR'"
  )
  $accountValue = (@($accountProbe | ForEach-Object { $_.ToString() }) -join '').Trim()
  if ($accountValue -ne '1|1') { throw "Account isolation probe failed: $accountValue" }

  $orphanProbe = Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
    '-U', 'db_template_submit_bootstrap', '-d', 'postgres', '-c',
    "SELECT count(*) FILTER (WHERE user_id = '00000000-0000-4000-8000-000000000005'::uuid AND body_text = 'Orphan body')::text || '|' || count(*) FILTER (WHERE user_id = '00000000-0000-4000-8000-000000000001'::uuid AND body_text = 'Criador válido sintético')::text FROM public.message_templates WHERE account_id = '10000000-0000-4000-8000-000000000001' AND name = 'orphan_submit' AND language = 'pt_BR'"
  )
  $orphanValue = (@($orphanProbe | ForEach-Object { $_.ToString() }) -join '').Trim()
  if ($orphanValue -ne '1|1') { throw "Creator consistency probe failed: $orphanValue" }

  $invalidProbe = Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
    '-U', 'db_template_submit_bootstrap', '-d', 'postgres', '-c',
    "SELECT count(*)::text FROM public.message_templates WHERE name = 'Constraint probe'"
  )
  $invalidValue = (@($invalidProbe | ForEach-Object { $_.ToString() }) -join '').Trim()
  if ($invalidValue -ne '0') { throw "Failed constraint probe left a persisted row: $invalidValue" }
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value @(
    'Bootstrap post-probes passed: success result cleared stale error/rejection and updated media, failure result persisted DRAFT/error, same-named account members retained separate rows, trigger replaced old timestamps, concurrent operations produced exactly one row, cross-account row stayed separate, inconsistent creator remained untouched, and invalid status left no row.',
    'Only synthetic fixtures were queried.'
  )

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
    }
    else {
      $primaryFailure = $cleanup
    }
  }
}

if (-not $validationSucceeded) {
  if (Test-Path -LiteralPath $taskLog) {
    Add-Content -LiteralPath $taskLog -Encoding utf8 -Value 'Overall result: FAILURE'
  }
  Write-Error "PostgreSQL template-submit persistence validation failed: $primaryFailure"
  exit 1
}
Add-Content -LiteralPath $taskLog -Encoding utf8 -Value 'Overall result: SUCCESS'
Write-Output "SUCCESS: PostgreSQL template-submit persistence integration; log $taskLog"
exit 0
