import { copyFile, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const sourceRoot = path.join(projectRoot, 'assets', 'store', 'generated');
const brandAssetsRoot = path.join(
  projectRoot,
  'ios',
  'LofieverTV',
  'Images.xcassets',
  'TVAppIcon.brandassets'
);

const layers = ['Back', 'Middle', 'Front'];
const copies = [];

for (const layer of layers) {
  const sourceName = layer.toLowerCase();

  copies.push(
    [
      `app-icon-${sourceName}-1280x768.png`,
      `App Icon - Large.imagestack/${layer}.imagestacklayer/Content.imageset/icon-1280x768.png`,
    ],
    [
      `app-icon-${sourceName}-400x240.png`,
      `App Icon - Small.imagestack/${layer}.imagestacklayer/Content.imageset/icon-400x240.png`,
    ],
    [
      `app-icon-${sourceName}-800x480.png`,
      `App Icon - Small.imagestack/${layer}.imagestacklayer/Content.imageset/icon-800x480.png`,
    ]
  );
}

for (const [source, destination] of copies) {
  const sourcePath = path.join(sourceRoot, source);
  const destinationPath = path.join(brandAssetsRoot, destination);

  await stat(sourcePath);
  await stat(path.dirname(destinationPath));
  await copyFile(sourcePath, destinationPath);
}

const appConfig = JSON.parse(await readFile(path.join(projectRoot, 'app.json'), 'utf8'));
const version = appConfig.expo.version;
const buildNumber = appConfig.expo.ios.buildNumber;
const projectFile = path.join(projectRoot, 'ios', 'LofieverTV.xcodeproj', 'project.pbxproj');
const projectContents = await readFile(projectFile, 'utf8');
const versionedProjectContents = projectContents
  .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`)
  .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${buildNumber};`);

await writeFile(projectFile, versionedProjectContents);

console.log(`Layered tvOS assets and version ${version} (${buildNumber}) synchronized.`);
