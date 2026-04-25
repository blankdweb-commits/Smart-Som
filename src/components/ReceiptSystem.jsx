import React from 'react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { Download, CheckCircle2, ShieldCheck, Printer } from './Icons';

export const generateReceipt = async (transaction, profile, feeDetails) => {
  const element = document.createElement('div');
  element.style.padding = '40px';
  element.style.background = '#ffffff';
  element.style.width = '800px';
  element.style.fontFamily = 'Arial, sans-serif';

  element.innerHTML = `
    <div style="border: 2px solid #0f172a; padding: 40px; border-radius: 20px;">
      <div style="display: flex; justify-between; align-items: center; border-bottom: 2px solid #f1f5f9; padding-bottom: 20px; margin-bottom: 30px;">
        <div>
          <h1 style="color: #0d9488; margin: 0; font-size: 32px;">NursingHub</h1>
          <p style="color: #64748b; margin: 5px 0 0 0; font-size: 14px; text-transform: uppercase; letter-spacing: 2px; font-weight: bold;">Official Payment Receipt</p>
        </div>
        <div style="text-align: right;">
          <p style="margin: 0; font-weight: bold; color: #0f172a;">Date: ${new Date(transaction.date).toLocaleDateString()}</p>
          <p style="margin: 5px 0 0 0; color: #64748b;">ID: ${transaction.id}</p>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-bottom: 40px;">
        <div>
          <h3 style="color: #64748b; font-size: 12px; text-transform: uppercase; margin-bottom: 15px;">Student Information</h3>
          <p style="margin: 0; font-weight: bold; font-size: 18px;">${profile.fullName}</p>
          <p style="margin: 5px 0 0 0; color: #0f172a;">Matric: ${profile.matricNumber}</p>
          <p style="margin: 5px 0 0 0; color: #0f172a;">${profile.department} - ${profile.level}</p>
        </div>
        <div style="text-align: right;">
          <h3 style="color: #64748b; font-size: 12px; text-transform: uppercase; margin-bottom: 15px;">Payment Summary</h3>
          <p style="margin: 0; color: #64748b;">Session: ${profile.session}</p>
          <p style="margin: 5px 0 0 0; color: #64748b;">Method: ${transaction.method}</p>
        </div>
      </div>

      <div style="background: #f8fafc; padding: 30px; border-radius: 15px; margin-bottom: 40px;">
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="border-bottom: 1px solid #e2e8f0; text-align: left;">
              <th style="padding-bottom: 15px; color: #64748b; font-size: 12px; text-transform: uppercase;">Description</th>
              <th style="padding-bottom: 15px; color: #64748b; font-size: 12px; text-transform: uppercase; text-align: right;">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="padding: 20px 0; font-weight: bold; color: #0f172a;">${transaction.type}</td>
              <td style="padding: 20px 0; font-weight: bold; color: #0f172a; text-align: right;">${feeDetails.currency} ${transaction.amount.toLocaleString()}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr style="border-top: 2px solid #e2e8f0;">
              <td style="padding-top: 20px; font-weight: bold; color: #64748b;">Total Paid</td>
              <td style="padding-top: 20px; font-weight: bold; color: #0d9488; font-size: 24px; text-align: right;">${feeDetails.currency} ${transaction.amount.toLocaleString()}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div style="text-align: center; border-top: 1px solid #f1f5f9; padding-top: 30px;">
        <p style="color: #059669; font-weight: bold; display: flex; align-items: center; justify-content: center; gap: 10px;">
          ✓ TRANSACTION VERIFIED & SECURED
        </p>
        <p style="color: #94a3b8; font-size: 12px; margin-top: 10px;">This is a computer generated receipt and requires no physical signature.</p>
      </div>
    </div>
  `;

  document.body.appendChild(element);
  const canvas = await html2canvas(element);
  const imgData = canvas.toDataURL('image/png');
  const pdf = new jsPDF('p', 'mm', 'a4');
  const imgProps = pdf.getImageProperties(imgData);
  const pdfWidth = pdf.internal.pageSize.getWidth();
  const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;

  pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
  pdf.save(`NursingHub-Receipt-${transaction.id}.pdf`);
  document.body.removeChild(element);
};

const ReceiptSystem = ({ transaction }) => {
  const { userProfile, feeDetails } = useAppContext();

  return (
    <button
      onClick={() => generateReceipt(transaction, userProfile, feeDetails)}
      className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-700 rounded-xl text-xs font-bold hover:bg-emerald-100 transition-all"
    >
      <Download size={16} /> Download Receipt
    </button>
  );
};

export default ReceiptSystem;
