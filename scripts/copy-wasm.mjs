import { copyFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = dirname(scriptDirectory);
const sourceDirectory = join(projectDirectory, 'node_modules/@tensorflow/tfjs-tflite/wasm');
const destinationDirectory = join(projectDirectory, 'public/wasm');
const vendorDirectory = join(projectDirectory, 'public/vendor');
const modelCopies = [
  ['model/keypoint_classifier/keypoint_classifier.tflite', 'public/model/keypoint_classifier/keypoint_classifier.tflite'],
  ['model/point_history_classifier/point_history_classifier.tflite', 'public/model/point_history_classifier/point_history_classifier.tflite'],
];
await rm(destinationDirectory, { recursive: true, force: true });
await mkdir(destinationDirectory, { recursive: true });
await mkdir(vendorDirectory, { recursive: true });
await Promise.all(modelCopies.map(async ([source, destination]) => {
  const destinationPath = join(projectDirectory, destination);
  await mkdir(dirname(destinationPath), { recursive: true });
  await copyFile(join(projectDirectory, source), destinationPath);
}));
const runtimeFiles = ['tflite_web_api_cc.js', 'tflite_web_api_cc.wasm', 'tflite_web_api_cc_simd.js', 'tflite_web_api_cc_simd.wasm', 'tflite_web_api_client.js'];
await Promise.all(runtimeFiles.map((file) => copyFile(join(sourceDirectory, file), join(destinationDirectory, file))));
await copyFile(
  join(projectDirectory, 'node_modules/@tensorflow/tfjs-tflite/dist/tf-tflite.js'),
  join(vendorDirectory, 'tf-tflite.js'),
);
