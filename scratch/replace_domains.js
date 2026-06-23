const fs = require('fs');
const path = require('path');

const targetDir = path.resolve(__dirname, '..');
const fileExtensions = ['.html', '.xml', '.txt', '.js'];

function walkDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      if (file !== '.git' && file !== 'node_modules' && file !== '.github' && file !== 'scratch') {
        walkDir(filePath);
      }
    } else {
      const ext = path.extname(file).toLowerCase();
      if (fileExtensions.includes(ext)) {
        replaceInFile(filePath);
      }
    }
  }
}

function replaceInFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let hasChange = false;

  // Revert email
  if (content.includes('admin@gate-rank.com')) {
    content = content.replace(/admin@gate-rank\.com/g, 'admin@jctuijian.com');
    hasChange = true;
  }

  // Revert Gate-Rank to JcTuijian
  if (content.includes('Gate-Rank.com')) {
    content = content.replace(/Gate-Rank\.com/g, 'JcTuijian.com');
    hasChange = true;
  }
  if (content.includes('Gate-Rank')) {
    content = content.replace(/Gate-Rank/g, 'JcTuijian');
    hasChange = true;
  }
  if (content.includes('gate-rank.com')) {
    content = content.replace(/gate-rank\.com/g, 'jctuijian.com');
    hasChange = true;
  }
  if (content.includes('gate-rank')) {
    content = content.replace(/gate-rank/g, 'jctuijian');
    hasChange = true;
  }

  if (hasChange) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Reverted: ${path.relative(targetDir, filePath)}`);
  }
}

console.log('Starting reversion process...');
walkDir(targetDir);
console.log('Reversion finished!');
