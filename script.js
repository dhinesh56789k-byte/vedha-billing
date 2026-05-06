const fs = require('fs');
let content = fs.readFileSync('frontend/src/POS.jsx', 'utf8');

content = content.replace(/<input value=\{props.customer\}/g, `<input type="search" value={props.customer}`);
content = content.replace(/<input value=\{props.address\}/g, `<input type="search" value={props.address}`);
content = content.replace(/<input value=\{props.gstNumber\}/g, `<input type="search" value={props.gstNumber}`);
content = content.replace(/<input value=\{search\}/g, `<input type="search" value={search}`);
content = content.replace(/<input\s+placeholder="Search products or categories"/g, `<input type="search" placeholder="Search products or categories"`);
content = content.replace(/<input placeholder="Product name"/g, `<input type="search" placeholder="Product name"`);
content = content.replace(/<input placeholder="Description"/g, `<input type="search" placeholder="Description"`);
content = content.replace(/<input placeholder="Category"/g, `<input type="search" placeholder="Category"`);
content = content.replace(/<input placeholder="Username"/g, `<input type="search" placeholder="Username"`);
content = content.replace(/<input placeholder="Shop location/g, `<input type="search" placeholder="Shop location`);

content = content.replace(
  /<input value=\{props\.phone\} placeholder="Phone" onChange=\{\(event\) => props\.setPhone\(event\.target\.value\)\} \/>/g,
  `<input type="search" value={props.phone} placeholder="Phone (Press Enter)" onChange={(event) => props.setPhone(event.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') searchCustomerByPhone(props.phone); }} />`
);

fs.writeFileSync('frontend/src/POS.jsx', content);
