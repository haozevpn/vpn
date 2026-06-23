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

  // Replace email
  if (content.includes('admin@jctuijian.com')) {
    content = content.replace(/admin@jctuijian\.com/g, 'admin@gate-rank.com');
    hasChange = true;
  }

  // Replace JcTuijian.com
  if (content.includes('JcTuijian.com')) {
    content = content.replace(/JcTuijian\.com/g, 'Gate-Rank.com');
    hasChange = true;
  }
  if (content.includes('JcTuijian')) {
    content = content.replace(/JcTuijian/g, 'Gate-Rank');
    hasChange = true;
  }
  if (content.includes('jctuijian')) {
    content = content.replace(/jctuijian/g, 'gate-rank');
    hasChange = true;
  }

  if (hasChange) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Updated: ${path.relative(targetDir, filePath)}`);
  }
}

console.log('Starting replacement process...');
walkDir(targetDir);
console.log('Replacement finished!');
