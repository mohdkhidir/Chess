// Starting library loaded on first setup. Everything here is editable in Master Data.
// Frequencies and lifespans are typical planning defaults, not regulatory values:
// replace them with the manufacturer's recommendations and your hospital policy.

const GENERAL = [
  'Visual inspection: housing, mounts, castors and labels intact',
  'Power cord, plug and strain relief in good condition',
  'Controls, switches, display and indicators working',
  'Battery condition and operation on battery',
  'Audible and visual alarms tested',
  'Accessories, cables, probes and hoses inspected',
  'Cleaned and decontaminated; PPM sticker updated',
];

const SPECIFIC = {
  INF: [
    'Flow rate accuracy with infusion device analyser (within manufacturer spec)',
    'Occlusion pressure alarm (upstream and downstream)',
    'Air-in-line detector test',
    'Door, clamp and free-flow protection check',
    'Drug library / firmware version recorded',
  ],
  SYR: [
    'Flow rate accuracy with infusion device analyser (within manufacturer spec)',
    'Occlusion alarm test',
    'Syringe size detection and plunger clamp check',
    'Near-empty / end-of-infusion alarm',
  ],
  MON: [
    'ECG / heart rate accuracy with patient simulator',
    'NIBP static pressure accuracy and leak test',
    'SpO2 check with simulator',
    'Temperature channel check',
    'IBP / EtCO2 modules check (if fitted)',
    'Central station / network connectivity',
  ],
  VEN: [
    'Tidal volume accuracy with gas flow analyser',
    'Pressure accuracy (PIP / PEEP)',
    'FiO2 / O2 sensor calibration',
    'Alarm tests: disconnect, high pressure, apnoea, low O2',
    'Internal leak / extended self-test passed',
    'Preventive maintenance kit replaced if due (filters, seals)',
  ],
  DEF: [
    'Delivered energy at low / medium / maximum with defibrillator analyser',
    'Charge time to maximum energy',
    'Synchronised cardioversion test',
    'Pacer output test (if fitted)',
    'Paddles / pads cable and connector check',
    'Recorder and event log check',
  ],
  ECG: [
    'Lead set and patient cable continuity',
    '1 mV calibration signal and paper speed',
    'Simulator test: rhythm and amplitude accuracy',
    'Printer head and paper drive check',
  ],
  ESU: [
    'Output power at rated loads (monopolar / bipolar) with ESU analyser',
    'Return electrode monitoring (REM) alarm',
    'HF leakage current test',
    'Footswitch and handpiece activation',
  ],
  ANA: [
    'High and low pressure system leak test',
    'Flowmeter accuracy (O2 / Air / N2O)',
    'Vaporiser output check',
    'O2 supply failure alarm and hypoxic guard',
    'Ventilator volume / pressure accuracy',
    'APL valve, bellows and CO2 absorber check',
    'Scavenging system check',
  ],
  SUC: [
    'Maximum vacuum and regulator accuracy',
    'Leak test, overflow protection and filter',
    'Tubing, canister and seals checked',
  ],
  USG: [
    'Transducer inspection (housing, lens, cable)',
    'Image quality check (phantom if available)',
    'Measurement / calculation accuracy check',
    'Fans and air filters cleaned',
    'Printer / DICOM / storage check',
  ],
  XRM: [
    'kVp accuracy and reproducibility (non-invasive meter)',
    'Exposure time and mAs accuracy',
    'Collimator light / beam alignment',
    'Arm, brakes, drive and interlocks',
    'Exposure switch and warning indicators',
    'Radiation QA per licence conditions (qualified person)',
  ],
  INC: [
    'Air temperature accuracy with incubator analyser',
    'Skin temperature probe and servo control',
    'Over-temperature and power failure alarms',
    'Humidity / O2 control (if fitted)',
    'Air flow / fan alarm',
    'Door seals, portholes and mattress tray',
  ],
  PHO: [
    'Irradiance measured with radiometer',
    'Lamp / LED hours recorded; replaced if below spec',
    'Timer and cooling fan function',
  ],
  DIA: [
    'Conductivity and temperature calibration',
    'Blood leak and air detector tests',
    'Arterial / venous / TMP pressure calibration',
    'Ultrafiltration accuracy test',
    'Disinfection cycle check',
  ],
  AUT: [
    'Bowie-Dick / air removal test',
    'Chamber temperature and pressure verification',
    'Door gasket and interlock check',
    'Safety valve test',
    'Vacuum leak rate test',
    'Pressure vessel certificate (DOSH) validity checked',
  ],
  CEN: [
    'Speed (RPM) verification with tachometer',
    'Timer accuracy',
    'Lid lock interlock',
    'Imbalance detection',
  ],
  SPO: ['SpO2 / pulse rate check with simulator', 'Probe and cable inspection'],
  BPM: ['Static pressure accuracy (within ±3 mmHg)', 'Leak test', 'Over-pressure safety', 'Cuff and hose inspection'],
  BWM: ['Outlet temperature accuracy', 'Over-temperature alarm', 'Heating plate / cassette check'],
  OTL: ['Illuminance (lux) measurement', 'LED / bulb module check', 'Arm movement, brakes and balance'],
  OTT: ['All motorised movements and limits', 'Hydraulic leak check', 'Brakes and floor lock', 'Hand control and battery'],
};

// code, name, risk class (Act 737 classes A-D), criticality, PPM months, lifespan years
const CATS = [
  ['INF', 'Infusion Pump', 'C', 'High', 12, 8],
  ['SYR', 'Syringe Pump', 'C', 'High', 12, 8],
  ['MON', 'Patient Monitor', 'C', 'High', 12, 8],
  ['VEN', 'Ventilator', 'C', 'High', 6, 10],
  ['DEF', 'Defibrillator', 'C', 'High', 6, 8],
  ['ECG', 'ECG Machine', 'B', 'Medium', 12, 8],
  ['ESU', 'Electrosurgical Unit', 'C', 'High', 6, 10],
  ['ANA', 'Anaesthesia Machine', 'C', 'High', 6, 12],
  ['SUC', 'Suction Apparatus', 'B', 'Medium', 12, 7],
  ['USG', 'Ultrasound System', 'B', 'Medium', 12, 8],
  ['XRM', 'Mobile X-Ray', 'C', 'Medium', 6, 10],
  ['INC', 'Infant Incubator', 'C', 'High', 6, 10],
  ['PHO', 'Phototherapy Unit', 'B', 'Medium', 12, 8],
  ['DIA', 'Haemodialysis Machine', 'C', 'High', 6, 8],
  ['AUT', 'Steam Steriliser (Autoclave)', 'B', 'High', 3, 15],
  ['CEN', 'Centrifuge', 'B', 'Low', 12, 10],
  ['SPO', 'Pulse Oximeter', 'B', 'Medium', 12, 5],
  ['BPM', 'NIBP Monitor', 'B', 'Low', 12, 5],
  ['BWM', 'Blood / Fluid Warmer', 'B', 'Medium', 12, 8],
  ['OTL', 'Operating Light', 'A', 'Medium', 12, 15],
  ['OTT', 'Operating Table', 'A', 'Medium', 12, 15],
];

export const DEFAULT_CATEGORIES = CATS.map(([code, name, risk_class, criticality, ppm, life]) => ({
  code,
  name,
  risk_class,
  criticality,
  ppm_frequency_months: ppm,
  lifespan_years: life,
  est_required: 1,
  checklist: [...GENERAL, ...(SPECIFIC[code] || [])],
}));

export const GENERAL_CHECKLIST = GENERAL;

export const DEFAULT_DEPARTMENTS = [
  ['ETD', 'Emergency & Trauma Department', 'Clinical'],
  ['ICU', 'Intensive Care Unit', 'Clinical'],
  ['OT', 'Operation Theatre', 'Clinical'],
  ['RAD', 'Radiology (Diagnostic Imaging)', 'Clinical Support'],
  ['PATH', 'Pathology Laboratory', 'Clinical Support'],
  ['MW', 'Medical Ward', 'Clinical'],
  ['SW', 'Surgical Ward', 'Clinical'],
  ['PAED', 'Paediatric Ward', 'Clinical'],
  ['NICU', 'Neonatal ICU', 'Clinical'],
  ['OG', 'Obstetrics & Gynaecology (Labour Room)', 'Clinical'],
  ['HD', 'Haemodialysis Unit', 'Clinical'],
  ['CSSU', 'Central Sterile Supply Unit', 'Clinical Support'],
  ['SOPD', 'Specialist Clinics (Outpatient)', 'Clinical'],
  ['REHAB', 'Rehabilitation / Physiotherapy', 'Clinical Support'],
  ['BME', 'Biomedical Engineering Unit', 'Non-Clinical'],
].map(([code, name, type]) => ({ code, name, type }));

export const FAILURE_CAUSES = [
  'Wear and tear',
  'Component failure',
  'Accessory / probe damage',
  'Battery failure',
  'Power supply issue',
  'Software / firmware',
  'User error / mishandling',
  'Physical damage / dropped',
  'Liquid spill / environmental',
  'Calibration drift',
  'No fault found',
  'Other',
];

export const VENDOR_TYPES = ['Manufacturer', 'Supplier', 'Service Contractor', 'Authorised Representative'];
export const FUNDING_SOURCES = ['Government', 'Development fund', 'Donation', 'Lease / Rental', 'Loan unit', 'Private purchase'];
export const TICKET_CATEGORIES = {
  BREAKDOWN: 'Breakdown / not working',
  MALFUNCTION: 'Malfunction / error message',
  DAMAGE: 'Physical damage',
  ACCESSORY: 'Accessory / consumable problem',
  CALIBRATION: 'Calibration / accuracy concern',
  INSTALLATION: 'Installation / relocation',
  TRAINING: 'User training request',
  OTHER: 'Other',
};
