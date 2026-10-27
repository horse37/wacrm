param(
  [string]$PostgresImage = 'postgres:16-alpine',
  [string]$NodeImage = 'node:22-bookworm'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$taskId = '20261020-083039-2120'
$suffix = [guid]::NewGuid().ToString('N').Substring(0, 10)
$databaseContainer = "wacrm-automation-log-finalize-db-$suffix"
$nodeContainer = "wacrm-automation-log-finalize-node-$suffix"
$bootstrapPassword = [guid]::NewGuid().ToString('N')
$runtimePassword = [guid]::NewGuid().ToString('N')
$taskLog = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "../../.harness/tasks/$taskId/validation-postgres-automation-log-finalize-$suffix.log"))
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
  New-Item -ItemType File -Path $taskLog | Out-Null
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value @(
    "Command: docker run -d --rm --name $databaseContainer --network none --tmpfs /var/lib/postgresql/data:rw,nosuid,nodev,size=384m -e POSTGRES_USER=automation_log_finalize_bootstrap -e POSTGRES_PASSWORD=<synthetic-generated> -e POSTGRES_DB=postgres --mount <read-only-repository> $PostgresImage",
    "Disposable PostgreSQL image: $PostgresImage; database is tmpfs; no published ports or named volumes.",
    'Synthetic automation-log rows only. Bootstrap/runtime passwords are random for this run and are not recorded.'
  )

  Invoke-DockerChecked @('pull', $NodeImage) | Out-Null
  Invoke-DockerChecked @(
    'run', '-d', '--rm', '--name', $databaseContainer, '--network', 'none',
    '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,nodev,size=384m',
    '--mount', "type=bind,source=$repoRoot,target=/repo,readonly",
    '-e', 'POSTGRES_USER=automation_log_finalize_bootstrap',
    '-e', "POSTGRES_PASSWORD=$bootstrapPassword",
    '-e', 'POSTGRES_DB=postgres', $PostgresImage
  ) | Out-Null
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value @(
    "PostgreSQL image ID: $(& docker image inspect --format '{{.Id}}' $PostgresImage)",
    "Node image ID: $(& docker image inspect --format '{{.Id}}' $NodeImage)"
  )

  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    & docker exec $databaseContainer pg_isready -U automation_log_finalize_bootstrap -d postgres *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'Disposable PostgreSQL did not become ready.' }

  Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', 'automation_log_finalize_bootstrap', '-d', 'postgres', '-f',
    "/repo/.harness/tasks/$taskId/postgres-automation-log-finalize-fixture.sql"
  ) | Out-Null
  Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', 'automation_log_finalize_bootstrap', '-d', 'postgres', '-c',
    "ALTER ROLE wacrm_automation_log_finalize_job PASSWORD '$runtimePassword'"
  ) | Out-Null

  $databaseUrl = "postgres://wacrm_automation_log_finalize_job:$runtimePassword@127.0.0.1:5432/postgres"
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value @(
    "Command: docker run --rm --name $nodeContainer --network container:$databaseContainer --mount type=bind,source=$repoRoot,target=/source,readonly --workdir /source -e DATABASE_URL=postgres://wacrm_automation_log_finalize_job:<synthetic-generated>@127.0.0.1:5432/postgres $NodeImage node --conditions=react-server --import ./scripts/testing/register-typescript-extensionless-loader.mjs --experimental-strip-types --experimental-default-type=module scripts/testing/postgres-automation-log-finalize-integration.mjs",
    'Node container shares only the disposable database network namespace; repository mount is read-only.'
  )

  $nodeArgs = @(
    'run', '--rm', '--name', $nodeContainer,
    '--network', "container:$databaseContainer",
    '--mount', "type=bind,source=$repoRoot,target=/source,readonly",
    '--workdir', '/source', '-e', "DATABASE_URL=$databaseUrl",
    $NodeImage, 'node', '--conditions=react-server', '--import',
    './scripts/testing/register-typescript-extensionless-loader.mjs',
    '--experimental-strip-types', '--experimental-default-type=module',
    'scripts/testing/postgres-automation-log-finalize-integration.mjs'
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
  if ($nodeExitCode -ne 0) { throw "PostgreSQL automation-log finalization integration failed with exit $nodeExitCode." }

  $auditSql = @'
DO $$
BEGIN
  IF (SELECT count(*) FROM public.automation_logs) <> 4 THEN
    RAISE EXCEPTION 'expected exactly four synthetic automation logs';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.automation_logs
    WHERE id = '70000000-0000-4000-8000-000000000001'
      AND status = 'success'
      AND error_message IS NULL
      AND private_payload = 'SYNTHETIC_PRIVATE_PAYLOAD'
  ) THEN RAISE EXCEPTION 'successful finalization did not clear the prior error'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.automation_logs
    WHERE id = '70000000-0000-4000-8000-000000000002'
      AND status = 'failed'
      AND error_message = 'new synthetic failure'
      AND private_payload = 'SYNTHETIC_PRIVATE_PAYLOAD'
  ) THEN RAISE EXCEPTION 'failed finalization did not write its error'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.automation_logs
    WHERE id = '70000000-0000-4000-8000-000000000003'
      AND status = 'partial'
      AND error_message = ''
  ) THEN RAISE EXCEPTION 'explicit empty error was not written'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.automation_logs
    WHERE id = '70000000-0000-4000-8000-000000000004'
      AND status = 'success'
      AND error_message = 'ROLLBACK_ORIGINAL_ERROR'
  ) THEN RAISE EXCEPTION 'constraint failure did not roll back status and error'; END IF;
END
$$;
'@
  $auditOutput = Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', 'automation_log_finalize_bootstrap', '-d', 'postgres', '-c', $auditSql
  )
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value 'Bootstrap-only stored-row audit: PASS (status update, explicit error set/clear, rollback, private payload preserved).'
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
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value 'Overall result: FAILURE'
  Write-Error "PostgreSQL automation-log finalization validation failed: $primaryFailure"
  exit 1
}
Add-Content -LiteralPath $taskLog -Encoding utf8 -Value 'Overall result: SUCCESS'
Write-Output "SUCCESS: PostgreSQL automation-log finalization integration; log $taskLog"
exit 0
