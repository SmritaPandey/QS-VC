const puppeteer = require('puppeteer');
const path = require('path');

async function convertToPDF() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  // 1. Data Sheet PDF
  console.log('Converting datasheet.html to PDF...');
  const page1 = await browser.newPage();
  await page1.goto('file:///' + path.resolve('datasheet.html').replace(/\\/g, '/'), { waitUntil: 'networkidle0' });
  await page1.pdf({
    path: 'QS-VC_Data_Sheet.pdf',
    format: 'A4',
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 }
  });
  console.log('✓ QS-VC_Data_Sheet.pdf created');

  // 2. Brochure PDF
  console.log('Converting brochure.html to PDF...');
  const page2 = await browser.newPage();
  await page2.goto('file:///' + path.resolve('brochure.html').replace(/\\/g, '/'), { waitUntil: 'networkidle0' });
  await page2.pdf({
    path: 'QS-VC_Marketing_Brochure.pdf',
    format: 'A4',
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 }
  });
  console.log('✓ QS-VC_Marketing_Brochure.pdf created');

  await browser.close();
  console.log('\nAll PDF conversions complete!');
}

convertToPDF().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
