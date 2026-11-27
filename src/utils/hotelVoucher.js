/* Hotel voucher PDF — pdfkit layout + QR code → uploads/vouchers/*.pdf */
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

const VOUCHER_DIR = path.join(__dirname, '..', '..', 'uploads', 'vouchers');
const PUBLIC_BASE = '/uploads/vouchers';

const ensureDir = () => {
  if (!fs.existsSync(VOUCHER_DIR)) fs.mkdirSync(VOUCHER_DIR, { recursive: true });
};

const pdfRelPath = (code) => `vouchers/${code}.pdf`;
const pdfUrl = (code) => `${PUBLIC_BASE}/${code}.pdf`;
const pdfExists = (code) => fs.existsSync(path.join(VOUCHER_DIR, `${code}.pdf`));

const inr = (n) => `INR ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* Generates (or returns cached) voucher PDF. Returns relative path 'vouchers/<code>.pdf'. */
async function generateVoucherPdf(reservation, property, room) {
  ensureDir();
  const code = reservation.reservation_code;
  if (pdfExists(code)) return pdfRelPath(code);

  const qrData = `VCOM_HOTEL_${code}_VERIFIED`;
  const qrBuffer = await QRCode.toBuffer(qrData, { type: 'png', width: 180, margin: 1 });

  return new Promise((resolve, reject) => {
    const filePath = path.join(VOUCHER_DIR, `${code}.pdf`);
    const doc = new PDFDocument({ size: 'A5', margin: 36 });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // header
    doc.rect(0, 0, doc.page.width, 58).fill('#0f2a4a');
    doc.fillColor('#ffffff').fontSize(16).font('Helvetica-Bold').text('V-COM BOOKINGS', 36, 16);
    doc.fontSize(8).font('Helvetica').text('Discover. Stay. Experience.', 36, 38);
    doc.fontSize(9).font('Helvetica-Bold').text('BOOKING VOUCHER', 36, 20, { width: doc.page.width - 72, align: 'right' });

    let y = 76;
    doc.fillColor('#0f2a4a').fontSize(13).font('Helvetica-Bold').text(property.name, 36, y, { width: 330 });
    y += 20;
    doc.fillColor('#444444').fontSize(9).font('Helvetica').text(property.location, 36, y, { width: 330 });
    y += 22;

    doc.moveTo(36, y).lineTo(doc.page.width - 36, y).strokeColor('#cccccc').stroke();
    y += 14;

    const line = (label, value) => {
      doc.fillColor('#777777').fontSize(8).font('Helvetica').text(label, 36, y, { width: 110 });
      doc.fillColor('#111111').fontSize(9).font('Helvetica-Bold').text(String(value), 150, y, { width: doc.page.width - 186 });
      y += 16;
    };

    line('Reservation ID', code);
    line('Guest', reservation.guest_name);
    line('Room', `${room.room_name} (${reservation.meal_plan} Plan)`);
    line('Guests', `${reservation.adults} Adults, ${reservation.children} Children — ${reservation.number_of_rooms} Room(s)`);
    line('Check-in', `${reservation.check_in_date} (${property.check_in_time})`);
    line('Check-out', `${reservation.check_out_date} (${property.check_out_time})`);
    line('Nights', reservation.number_of_nights);

    y += 6;
    doc.moveTo(36, y).lineTo(doc.page.width - 36, y).strokeColor('#cccccc').stroke();
    y += 14;

    doc.fillColor('#0f2a4a').fontSize(10).font('Helvetica-Bold').text('Payment Summary', 36, y);
    y += 16;
    const money = (label, value, bold) => {
      doc.fillColor(bold ? '#111111' : '#444444').fontSize(9).font(bold ? 'Helvetica-Bold' : 'Helvetica').text(label, 36, y, { width: 220 });
      doc.fillColor(bold ? '#111111' : '#444444').fontSize(9).font(bold ? 'Helvetica-Bold' : 'Helvetica').text(inr(value), 260, y, { width: doc.page.width - 296, align: 'right' });
      y += 15;
    };
    money('Room Tariff', reservation.room_tariff, false);
    money('Taxes & GST (18%)', reservation.taxes_gst, false);
    money('Extras', reservation.extras, false);
    y += 2;
    money('Total Amount', reservation.total_amount, true);
    doc.fillColor('#777777').fontSize(8).font('Helvetica').text(
      reservation.payment_method === 'online' ? 'Payment: Paid Online' : 'Payment: Pay at Property (balance due at hotel)',
      36, y, { width: doc.page.width - 72 }
    );
    y += 26;

    // QR
    doc.image(qrBuffer, 36, y, { width: 90, height: 90 });
    doc.fillColor('#444444').fontSize(8).font('Helvetica').text('Scan at reception', 36, y + 94, { width: 90, align: 'center' });
    doc.fillColor('#0f2a4a').fontSize(9).font('Helvetica-Bold').text('Verified Booking', 146, y + 16, { width: 180 });
    doc.fillColor('#666666').fontSize(8).font('Helvetica').text(qrData, 146, y + 34, { width: 190 });
    doc.fillColor('#999999').fontSize(7).font('Helvetica').text(
      'Free cancellation as per property policy. Carry a valid photo ID at check-in.',
      146, y + 66, { width: 190 }
    );

    doc.on('error', reject);
    stream.on('error', reject);
    stream.on('finish', () => resolve(pdfRelPath(code)));
    doc.end();
  });
}

module.exports = { generateVoucherPdf, pdfUrl, pdfExists, pdfRelPath, VOUCHER_DIR };
