param(
  [string]$PostgresImage = 'postgres:16-alpine',
  [string]$NodeImage = 'node:22-bookworm'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$taskId = '20261020-120813-3e6f'
$suffix = [guid]::NewGuid().ToString('N').Substring(0, 10)
$databaseContainer = "wacrm-pending-schedule-tenant-db-$suffix"
$nodeContainer = "wacrm-pending-schedule-tenant-node-$suffix"
$bootstrapPassword = [guid]::NewGuid().ToString('N')
$runtimePassword = [guid]::NewGuid().ToString('N')
$fixturePath = Join-Path $repoRoot ".harness/tasks/$taskId/postgres-automation-pending-schedule-tenant-fixture.sql"
$integrationPath = Join-Path $repoRoot 'scripts/testing/postgres-automation-pending-schedule-tenant-integration.mjs'
$taskLog = [System.IO.Path]::GetFullPath((Join-Path $repoRoot ".harness/tasks/$taskId/validation-postgres-automation-pending-schedule-tenant-$suffix.log"))
if (Test-Path -LiteralPath $taskLog) {
  throw "Refusing to overwrite existing validation log: $taskLog"
}

$validationSucceeded = $false
$primaryFailure = $null

function Invoke-DockerChecked {
  param([string[]]$Arguments)

  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = & docker @Arguments 2>&1
    $code = $LASTEXITCODE
  } finally {
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
  foreach ($requirement in @(
    'CREATE ROLE wacrm_automation_pending_schedule_tenant_job\s+LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS',
    'ALTER TABLE public\.automation_pending_executions ENABLE ROW LEVEL SECURITY;\s*ALTER TABLE public\.automation_pending_executions FORCE ROW LEVEL SECURITY;',
    'CREATE POLICY automation_pending_schedule_tenant_insert\s+ON public\.automation_pending_executions\s+FOR INSERT\s+TO wacrm_automation_pending_schedule_tenant_job',
    'is_account_member\(account_id, ''agent''\)\s+AND user_id = public\.wacrm_request_user_id\(\)\s+AND public\.is_automation_writer\(automation_id, account_id\)',
    'GRANT INSERT \(',
    'private_payload text NOT NULL DEFAULT ''SYNTHETIC_PRIVATE_PAYLOAD'''
  )) {
    if ($fixture -notmatch $requirement) {
      throw "Tenant fixture is missing required RLS/grant pattern: $requirement"
    }
  }

  $integration = Get-Content -LiteralPath $integrationPath -Raw
  foreach ($requiredText in @(
    'assertRlsDeniesInsert',
    'otherOwnerA',
    'writerB',
    'viewerA',
    'forgedIdentityId',
    'private-column protection',
    'transaction-local identity cleanup'
  )) {
    if ($integration -notmatch [regex]::Escape($requiredText)) {
      throw "Tenant integration is missing required probe: $requiredText"
    }
  }
  Write-Output 'PowerShell AST, forced-RLS fixture, owner/member policies, NOBYPASSRLS, and minimum-grant checks passed.'

  New-Item -ItemType File -Path $taskLog | Out-Null
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value @(
    "Command: docker run -d --rm --name $databaseContainer --network none --tmpfs /var/lib/postgresql/data:rw,nosuid,nodev,size=384m -e POSTGRES_USER=pending_schedule_tenant_bootstrap -e POSTGRES_PASSWORD=<synthetic-generated> -e POSTGRES_DB=postgres --mount <read-only-repository> $PostgresImage",
    "Disposable PostgreSQL image: $PostgresImage; database is tmpfs; no published ports or named volumes.",
    'Synthetic accounts, profiles, automation rows, and generated credentials only. Passwords are not recorded.'
  )

  Invoke-DockerChecked @('pull', $NodeImage) | Out-Null
  Invoke-DockerChecked @(
    'run', '-d', '--rm', '--name', $databaseContainer, '--network', 'none',
    '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,nodev,size=384m',
    '--mount', "type=bind,source=$repoRoot,target=/repo,readonly",
    '-e', 'POSTGRES_USER=pending_schedule_tenant_bootstrap',
    '-e', "POSTGRES_PASSWORD=$bootstrapPassword",
    '-e', 'POSTGRES_DB=postgres', $PostgresImage
  ) | Out-Null

  $imageIds = Invoke-DockerChecked @(
    'image', 'inspect', '--format', '{{.Id}}', $PostgresImage, $NodeImage
  )
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value (@($imageIds | ForEach-Object { $_.ToString() }) -join "`n")

  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    & docker exec $databaseContainer pg_isready -U pending_schedule_tenant_bootstrap -d postgres *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'Disposable PostgreSQL did not become ready.' }

  Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', 'pending_schedule_tenant_bootstrap', '-d', 'postgres', '-f',
    "/repo/.harness/tasks/$taskId/postgres-automation-pending-schedule-tenant-fixture.sql"
  ) | Out-Null
  Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', 'pending_schedule_tenant_bootstrap', '-d', 'postgres', '-c',
    "ALTER ROLE wacrm_automation_pending_schedule_tenant_job PASSWORD '$runtimePassword'"
  ) | Out-Null

  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value @(
    "Command: docker run --rm --name $nodeContainer --network container:$databaseContainer --mount type=bind,source=$repoRoot,target=/source,readonly --workdir /source -e DATABASE_URL=postgres://wacrm_automation_pending_schedule_tenant_job:<synthetic-generated>@127.0.0.1:5432/postgres $NodeImage node --conditions=react-server --import ./scripts/testing/register-typescript-extensionless-loader.mjs --experimental-strip-types --experimental-default-type=module scripts/testing/postgres-automation-pending-schedule-tenant-integration.mjs",
    'Node container shares only the disposable database network namespace; repository mount is read-only.'
  )

  Invoke-DockerChecked @(
    'run', '--rm', '--name', $nodeContainer,
    '--network', "container:$databaseContainer",
    '--mount', "type=bind,source=$repoRoot,target=/source,readonly",
    '--workdir', '/source',
    '-e', "DATABASE_URL=postgres://wacrm_automation_pending_schedule_tenant_job:$runtimePassword@127.0.0.1:5432/postgres",
    $NodeImage, 'node', '--conditions=react-server',
    '--import', './scripts/testing/register-typescript-extensionless-loader.mjs',
    '--experimental-strip-types', '--experimental-default-type=module',
    'scripts/testing/postgres-automation-pending-schedule-tenant-integration.mjs'
  ) | ForEach-Object { $_.ToString() | Add-Content -LiteralPath $taskLog -Encoding utf8 }

  $auditSql = @'
DO $$
DECLARE
  accepted_rows integer;
BEGIN
  SELECT count(*) INTO accepted_rows FROM public.automation_pending_executions;
  IF accepted_rows <> 3 THEN
    RAISE EXCEPTION 'expected exactly three accepted scheduled rows, got %', accepted_rows;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.automation_pending_executions
    WHERE account_id <> '10000000-0000-4000-8000-000000000001'::uuid
       OR user_id <> '00000000-0000-4000-8000-000000000001'::uuid
       OR private_payload <> 'SYNTHETIC_PRIVATE_PAYLOAD'
  ) THEN
    RAISE EXCEPTION 'tenant/owner/private-column audit failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.automation_pending_executions
    WHERE automation_id = '30000000-0000-4000-8000-000000000001'::uuid
      AND contact_id = '50000000-0000-4000-8000-000000000001'::uuid
      AND log_id = '60000000-0000-4000-8000-000000000001'::uuid
      AND parent_step_id = '70000000-0000-4000-8000-000000000001'::uuid
      AND branch = 'yes'
      AND next_step_position = 4
      AND context = '{"message_text":"Synthetic tenant fixture","vars":{"source":"docker"}}'::jsonb
      AND status = 'pending'
      AND run_at = '2026-10-20T12:00:00Z'::timestamptz
  ) THEN
    RAISE EXCEPTION 'owner schedule row did not match trusted context and execution payload';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.automation_pending_executions
    WHERE contact_id IS NULL AND log_id IS NULL AND parent_step_id IS NULL
      AND branch IS NULL AND context = '{}'::jsonb AND status = 'pending'
      AND run_at = '2026-10-20T13:00:00Z'::timestamptz
  ) THEN
    RAISE EXCEPTION 'nullable/default schedule row was not preserved';
  END IF;
END
$$;
'@
  $auditOutput = Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', 'pending_schedule_tenant_bootstrap', '-d', 'postgres', '-c', $auditSql
  )
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value 'Bootstrap-only stored-row audit: PASS (3 trusted tenant rows, forged input identity ignored, defaults preserved, private field unchanged, denials/constraint failure persisted no row).'
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value (@($auditOutput | ForEach-Object { $_.ToString() }) -join "`n")
  $validationSucceeded = $true
} catch {
  $primaryFailure = $_.Exception.Message
  if (Test-Path -LiteralPath $taskLog) {
    Add-Content -LiteralPath $taskLog -Encoding utf8 -Value "Validation failure: $primaryFailure"
  }
} finally {
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
  } elseif ($residual.Count -gt 0) {
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
  Write-Error "PostgreSQL pending-schedule tenant validation failed: $primaryFailure"
  exit 1
}

Add-Content -LiteralPath $taskLog -Encoding utf8 -Value 'Overall result: SUCCESS'
Write-Output "SUCCESS: PostgreSQL pending-schedule tenant integration; log $taskLog"
exit 0
