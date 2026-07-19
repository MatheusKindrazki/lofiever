import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const projectRoot = path.resolve(import.meta.dirname, '..');
const buildRoot = path.join(projectRoot, 'build');
const latestArchiveFile = path.join(buildRoot, 'latest-archive.txt');
const productionApiUrl = process.env.EXPO_PUBLIC_LOFIEVER_API_URL ?? 'https://app.lofiever.dev';
const teamId = 'YFYB6NKC73';

if (!productionApiUrl.startsWith('https://') || productionApiUrl.includes('localhost')) {
  throw new Error(`Release builds require an HTTPS production API URL, received: ${productionApiUrl}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env: {
      ...process.env,
      EXPO_TV: '1',
      EXPO_PUBLIC_LOFIEVER_API_URL: productionApiUrl,
    },
    stdio: 'inherit',
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status ?? 'unknown'}`);
  }
}

async function archive() {
  const appConfig = JSON.parse(await readFile(path.join(projectRoot, 'app.json'), 'utf8'));
  const version = appConfig.expo.version;
  const buildNumber = appConfig.expo.ios.buildNumber;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archivePath = path.join(
    buildRoot,
    `LofieverTV-${version}-${buildNumber}-${timestamp}.xcarchive`
  );

  await mkdir(buildRoot, { recursive: true });
  run('npm', ['run', 'verify']);
  run('npm', ['run', 'store:assets']);
  run('xcodebuild', [
    '-workspace',
    'ios/LofieverTV.xcworkspace',
    '-scheme',
    'LofieverTV',
    '-configuration',
    'Release',
    '-destination',
    'generic/platform=tvOS',
    '-archivePath',
    archivePath,
    `DEVELOPMENT_TEAM=${teamId}`,
    'CODE_SIGN_STYLE=Automatic',
    '-allowProvisioningUpdates',
    'archive',
  ]);

  await writeFile(latestArchiveFile, `${archivePath}\n`);
  console.log(`Archive ready: ${archivePath}`);
}

async function exportArchive() {
  const archivePath = (await readFile(latestArchiveFile, 'utf8')).trim();
  const exportPath = path.join(buildRoot, 'app-store-export');

  run('xcodebuild', [
    '-exportArchive',
    '-archivePath',
    archivePath,
    '-exportPath',
    exportPath,
    '-exportOptionsPlist',
    'release/ExportOptions-AppStore.plist',
    '-allowProvisioningUpdates',
  ]);

  console.log(`App Store export ready: ${exportPath}`);
}

async function uploadArchive() {
  const archivePath = (await readFile(latestArchiveFile, 'utf8')).trim();
  const uploadPath = path.join(buildRoot, 'app-store-upload');

  run('xcodebuild', [
    '-exportArchive',
    '-archivePath',
    archivePath,
    '-exportPath',
    uploadPath,
    '-exportOptionsPlist',
    'release/ExportOptions-Upload.plist',
    '-allowProvisioningUpdates',
  ]);

  console.log('App Store Connect upload completed.');
}

const action = process.argv[2];

if (action === 'archive') {
  await archive();
} else if (action === 'export') {
  await exportArchive();
} else if (action === 'upload') {
  await uploadArchive();
} else {
  throw new Error('Usage: node scripts/release-tvos.mjs <archive|export|upload>');
}
