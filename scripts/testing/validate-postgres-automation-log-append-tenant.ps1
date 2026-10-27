param(
  [string]$PostgresImage = 'postgres:16-alpine',
  [string]$NodeImage = 'node:22-bookworm'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$taskId = '20261020-083929-c2a6'
$suffix = [guid]::NewGuid().ToString('N').Substring(0, 10)
$databaseContainer = "wacrm-automation-log-append-tenant-db-$suffix"
$nodeContainer = "wacrm-automation-log-append-tenant-node-$suffix"
$bootstrapPassword = [guid]::NewGuid().ToString('N')
$runtimePassword = [guid]::NewGuid().ToString('N')
$fixturePath = Join-Path $repoRoot ".harness/tasks/$taskId/postgres-automation-log-append-tenant-fixture.sql"
$integrationPath = Join-Path $repoRoot 'scripts/testing/postgres-automation-log-append-tenant-integration.mjs'
$taskLog = [System.IO.Path]::GetFullPath((Join-Path $repoRoot ".harness/tasks/$taskId/validation-postgres-automation-log-append-tenant-$suffix.log"))
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
  $parseErrors = $null
  [System.Management.Automation.Language.Parser]::ParseFile(
    $PSCommandPath,
    [ref]$null,
    [ref]$parseErrors
  ) | Out-Null
  if ($parseErrors.Count -gt 0) {
    throw "PowerShell AST parse failed: $($parseErrors -join '; ')"
  }

  $fixture = Get-Content -LiteralPath $fixturePath -Raw
  $fixtureRequirements = @(
    'CREATE ROLE wacrm_automation_log_append_tenant_job LOGIN NOBYPASSRLS',
    'ALTER TABLE public\.automation_logs ENABLE ROW LEVEL SECURITY;\s*ALTER TABLE public\.automation_logs FORCE ROW LEVEL SECURITY;',
    'CREATE POLICY automation_log_append_tenant_update\s+ON public\.automation_logs\s+FOR UPDATE\s+TO wacrm_automation_log_append_tenant_job',
    "USING \(public\.is_account_member\(account_id, 'agent'\)\)",
    "WITH CHECK \(public\.is_account_member\(account_id, 'agent'\)\)",
    'REVOKE ALL ON FUNCTION public\.is_account_member',
    'GRANT EXECUTE ON FUNCTION public\.is_account_member',
    'GRANT UPDATE \(steps_executed, status, error_message\)'
  )
  foreach ($requirement in $fixtureRequirements) {
    if ($fixture -notmatch $requirement) {
      throw "Tenant fixture is missing required RLS/grant pattern: $requirement"
    }
  }

  $integration = Get-Content -LiteralPath $integrationPath -Raw
  foreach ($requiredText in @('assertRlsDenies', 'crossTenantId', 'sameTenantOtherOwnerId', 'viewerA', 'outsiderC')) {
    if ($integration -notmatch [regex]::Escape($requiredText)) {
      throw "Tenant integration is missing required probe: $requiredText"
    }
  }
  Write-Output 'PowerShell AST, fixture tenant RLS, NOBYPASSRLS, and minimum-grant checks passed.'

  New-Item -ItemType File -Path $taskLog | Out-Null
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value @(
    "Command: docker run -d --rm --name $databaseContainer --network none --tmpfs /var/lib/postgresql/data:rw,nosuid,nodev,size=384m -e POSTGRES_USER=automation_log_append_tenant_bootstrap -e POSTGRES_PASSWORD=<synthetic-generated> -e POSTGRES_DB=postgres --mount <read-only-repository> $PostgresImage",
    "Disposable PostgreSQL image: $PostgresImage; database is tmpfs; no published ports or named volumes.",
    'Synthetic tenants/logs only. Bootstrap/runtime passwords are randomly generated and are not recorded.'
  )

  Invoke-DockerChecked @('pull', $NodeImage) | Out-Null
  Invoke-DockerChecked @(
    'run', '-d', '--rm', '--name', $databaseContainer, '--network', 'none',
    '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,nodev,size=384m',
    '--mount', "type=bind,source=$repoRoot,target=/repo,readonly",
    '-e', 'POSTGRES_USER=automation_log_append_tenant_bootstrap',
    '-e', "POSTGRES_PASSWORD=$bootstrapPassword",
    '-e', 'POSTGRES_DB=postgres', $PostgresImage
  ) | Out-Null
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value @(
    "PostgreSQL image ID: $(& docker image inspect --format '{{.Id}}' $PostgresImage)",
    "Node image ID: $(& docker image inspect --format '{{.Id}}' $NodeImage)"
  )

  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    & docker exec $databaseContainer pg_isready -U automation_log_append_tenant_bootstrap -d postgres *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'Disposable PostgreSQL did not become ready.' }

  Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', 'automation_log_append_tenant_bootstrap', '-d', 'postgres', '-f',
    "/repo/.harness/tasks/$taskId/postgres-automation-log-append-tenant-fixture.sql"
  ) | Out-Null
  Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', 'automation_log_append_tenant_bootstrap', '-d', 'postgres', '-c',
    "ALTER ROLE wacrm_automation_log_append_tenant_job PASSWORD '$runtimePassword'"
  ) | Out-Null

  $databaseUrl = "postgres://wacrm_automation_log_append_tenant_job:$runtimePassword@127.0.0.1:5432/postgres"
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value @(
    "Command: docker run --rm --name $nodeContainer --network container:$databaseContainer --mount type=bind,source=$repoRoot,target=/source,readonly --workdir /source -e DATABASE_URL=postgres://wacrm_automation_log_append_tenant_job:<synthetic-generated>@127.0.0.1:5432/postgres -e PG_POOL_MAX=1 $NodeImage node --conditions=react-server --import ./scripts/testing/register-typescript-extensionless-loader.mjs --experimental-strip-types --experimental-default-type=module scripts/testing/postgres-automation-log-append-tenant-integration.mjs",
    'Node container shares only the disposable database network namespace; repository mount is read-only.'
  )

  $nodeArgs = @(
    'run', '--rm', '--name', $nodeContainer,
    '--network', "container:$databaseContainer",
    '--mount', "type=bind,source=$repoRoot,target=/source,readonly",
    '--workdir', '/source', '-e', "DATABASE_URL=$databaseUrl",
    '-e', 'PG_POOL_MAX=1', $NodeImage, 'node', '--conditions=react-server',
    '--import', './scripts/testing/register-typescript-extensionless-loader.mjs',
    '--experimental-strip-types', '--experimental-default-type=module',
    'scripts/testing/postgres-automation-log-append-tenant-integration.mjs'
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
  if ($nodeExitCode -ne 0) { throw "Tenant-scoped PostgreSQL automation-log append integration failed with exit $nodeExitCode." }

  $auditSql = @'
DO $$
BEGIN
  IF (SELECT count(*) FROM public.automation_logs) <> 6 THEN
    RAISE EXCEPTION 'expected exactly six synthetic automation logs';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.automation_logs
    WHERE id = '60000000-0000-4000-8000-000000000001'
      AND jsonb_array_length(steps_executed) = 5
      AND steps_executed -> 0 ->> 'step_id' = '50000000-0000-4000-8000-000000000000'
      AND steps_executed -> 1 ->> 'step_id' = '50000000-0000-4000-8000-000000000001'
      AND steps_executed -> 2 ->> 'step_id' = '50000000-0000-4000-8000-000000000002'
      AND steps_executed @> jsonb_build_array(jsonb_build_object('step_id', '50000000-0000-4000-8000-000000000003'))
      AND steps_executed @> jsonb_build_array(jsonb_build_object('step_id', '50000000-0000-4000-8000-000000000004'))
      AND status = 'partial'
      AND error_message = 'UPDATED_ERROR'
      AND private_payload = 'SYNTHETIC_PRIVATE_PAYLOAD'
  ) THEN RAISE EXCEPTION 'account A append or private-field audit failed'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.automation_logs
    WHERE id = '60000000-0000-4000-8000-000000000002'
      AND steps_executed = jsonb_build_array(jsonb_build_object(
        'step_id', '50000000-0000-4000-8000-000000000002',
        'step_type', 'add_tag',
        'status', 'skipped'
      ))
      AND status = 'partial'
      AND error_message = 'PRESERVE_ERROR'
      AND private_payload = 'SYNTHETIC_PRIVATE_PAYLOAD'
  ) THEN RAISE EXCEPTION 'null status/empty error did not preserve fields'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.automation_logs
    WHERE id = '60000000-0000-4000-8000-000000000003'
      AND steps_executed = jsonb_build_object('invalid', 'shape')
  ) THEN RAISE EXCEPTION 'malformed steps shape changed'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.automation_logs
    WHERE id = '60000000-0000-4000-8000-000000000004'
      AND steps_executed = '[]'::jsonb
      AND status = 'success'
      AND error_message = 'ROLLBACK_ORIGINAL_ERROR'
  ) THEN RAISE EXCEPTION 'constraint failure did not roll back the append'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.automation_logs
    WHERE id = '60000000-0000-4000-8000-000000000005'
      AND steps_executed = '[]'::jsonb
      AND status = 'success'
      AND error_message = 'CROSS_TENANT_ORIGINAL_ERROR'
      AND private_payload = 'SYNTHETIC_PRIVATE_PAYLOAD'
  ) THEN RAISE EXCEPTION 'account B row changed from account A probes'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.automation_logs
    WHERE id = '60000000-0000-4000-8000-000000000006'
      AND account_id = '20000000-0000-4000-8000-000000000001'
      AND user_id = '30000000-0000-4000-8000-000000000005'
      AND steps_executed = '[]'::jsonb
      AND status = 'success'
      AND error_message = 'SAME_ACCOUNT_OTHER_OWNER_ORIGINAL_ERROR'
      AND private_payload = 'SYNTHETIC_PRIVATE_PAYLOAD'
  ) THEN RAISE EXCEPTION 'same-account other-owner row changed from account A append'; END IF;
END
$$;
'@
  $auditOutput = Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', 'automation_log_append_tenant_bootstrap', '-d', 'postgres', '-c', $auditSql
  )
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value 'Bootstrap-only stored-row audit: PASS (same-account owner-scoped append, same-account other-owner unchanged, cross-account/viewer/membership denial, preservation, rollback, private payload unchanged).'
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value (@($auditOutput | ForEach-Object { $_.ToString() }) -join "`n")

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
  Write-Error "PostgreSQL automation-log append tenant validation failed: $primaryFailure"
  exit 1
}
Add-Content -LiteralPath $taskLog -Encoding utf8 -Value 'Overall result: SUCCESS'
Write-Output "SUCCESS: PostgreSQL automation-log append tenant integration; log $taskLog"
exit 0
