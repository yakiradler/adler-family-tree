import type { Member, Relationship } from '../types'

// ─────────────────────────────────────────────
// משפחת אדלר – נתוני מלאים לפי הרשימה המעודכנת
// ─────────────────────────────────────────────

export const ADLER_MEMBERS: Member[] = [

  // ═══════════════════════════════════════════
  // דור 0 – סבא וסבתא
  // ═══════════════════════════════════════════
  { id: 'g01', first_name: 'יצחק', last_name: 'אדלר', gender: 'male', created_by: 'demo' },
  { id: 'g02', first_name: 'שולמית', last_name: 'אדלר', gender: 'female', created_by: 'demo' },

  // ═══════════════════════════════════════════
  // דור 1 – שבעת ילדי יצחק ושולמית
  // ═══════════════════════════════════════════
  { id: 'c01', first_name: 'לאה צירל', last_name: 'אדלר', gender: 'female', created_by: 'demo' },
  { id: 'c02', first_name: 'נחמה שיינדל', last_name: 'פרקש', gender: 'female', created_by: 'demo' },
  { id: 'c03', first_name: 'יחזקאל', last_name: 'אדלר', gender: 'male', created_by: 'demo' },
  { id: 'c04', first_name: 'אברהם אליעזר', last_name: 'אדלר', gender: 'male', created_by: 'demo' },
  { id: 'c05', first_name: 'נתנאל', last_name: 'אדלר', gender: 'male', created_by: 'demo' },
  { id: 'c06', first_name: 'רבקה הניה', last_name: 'עמית', gender: 'female', nickname: 'ריבקי', created_by: 'demo' },
  { id: 'c07', first_name: 'צבי אריה', last_name: 'אדלר', gender: 'male', created_by: 'demo' },

  // ───────────────────────────────────────────
  // בני/בנות זוג – דור 1
  // ───────────────────────────────────────────
  { id: 's01', first_name: 'נתנאל', last_name: '', gender: 'male', bio: 'בעלה הראשון של לאה צירל', created_by: 'demo' },
  { id: 's02', first_name: 'אליאס', last_name: 'אקריב', gender: 'male', bio: 'בעלה של לאה צירל', created_by: 'demo' },
  { id: 's03', first_name: 'עמית', last_name: 'פרקש', gender: 'male', created_by: 'demo' },
  { id: 's04', first_name: 'לימור', last_name: 'אדלר', gender: 'female', created_by: 'demo' },
  { id: 's05', first_name: 'חנה מזל', last_name: 'אדלר', gender: 'female', created_by: 'demo' },
  { id: 's06', first_name: 'אדל רות', last_name: 'אדלר', gender: 'female', created_by: 'demo' },
  { id: 's07', first_name: 'אברהם', last_name: 'עמית', gender: 'male', nickname: 'אבריהמי', created_by: 'demo' },
  { id: 's08', first_name: 'ברכה נרי שרה', last_name: 'אדלר', gender: 'female', created_by: 'demo' },

  // ═══════════════════════════════════════════
  // דור 2 – ילדי לאה צירל
  // ═══════════════════════════════════════════
  // ילדים ביולוגיים (אמא: לאה צירל, אבא: נתנאל)
  { id: 'l01', first_name: 'שיראל', last_name: 'אדלר', gender: 'female', created_by: 'demo' },
  { id: 'l02', first_name: 'הלל', last_name: 'אדלר', gender: 'female', created_by: 'demo' },
  { id: 'l03', first_name: 'יגל יעקב אהרן', last_name: 'אדלר', gender: 'male', created_by: 'demo' },
  // בנות חורגות (אבא: אליאס אקריב)
  { id: 'l04', first_name: 'שיר', last_name: 'אקריב', gender: 'female', bio: 'בת חורגת', created_by: 'demo' },
  { id: 'l05', first_name: 'אור', last_name: 'אקריב', gender: 'female', bio: 'בת חורגת', created_by: 'demo' },
  // בעל שיר
  { id: 'ls1', first_name: 'שלומי', last_name: 'וולמן', gender: 'male', created_by: 'demo' },

  // ═══════════════════════════════════════════
  // דור 2 – ילדי נחמה שיינדל ועמית פרקש
  // ═══════════════════════════════════════════
  { id: 'n01', first_name: 'שירה יהודית', last_name: 'פרקש', gender: 'female', created_by: 'demo' },
  { id: 'n02', first_name: 'אברהם אליעזר', last_name: 'פרקש', gender: 'male', created_by: 'demo' },
  { id: 'n03', first_name: 'תמר', last_name: 'פרקש', gender: 'female', created_by: 'demo' },
  { id: 'n04', first_name: 'אלישבע', last_name: 'פרקש', gender: 'female', created_by: 'demo' },
  { id: 'n05', first_name: 'יעקב אהרון', last_name: 'פרקש', gender: 'male', created_by: 'demo' },
  { id: 'n06', first_name: 'אילה', last_name: 'פרקש', gender: 'female', created_by: 'demo' },
  { id: 'n07', first_name: 'יחזקאל ידידיה', last_name: 'פרקש', gender: 'male', bio: 'לרפואה שלמה', created_by: 'demo' },
  { id: 'n08', first_name: 'יהונתן', last_name: 'פרקש', gender: 'male', created_by: 'demo' },

  // ═══════════════════════════════════════════
  // דור 2 – ילדי יחזקאל ולימור
  // ═══════════════════════════════════════════
  { id: 'y01', first_name: 'אוראל', last_name: 'אדלר', gender: 'female', created_by: 'demo' },
  { id: 'y02', first_name: 'טליה שיינדל', last_name: 'אדלר', gender: 'female', created_by: 'demo' },
  { id: 'y03', first_name: 'אבישי', last_name: 'אדלר', gender: 'male', created_by: 'demo' },
  { id: 'y04', first_name: 'לביא', last_name: 'אדלר', gender: 'male', created_by: 'demo' },

  // ═══════════════════════════════════════════
  // דור 2 – ילדי אברהם אליעזר וחנה מזל
  // ═══════════════════════════════════════════
  { id: 'a01', first_name: 'יותם נחמן', last_name: 'אדלר', gender: 'male', created_by: 'demo' },
  { id: 'a02', first_name: 'הלני', last_name: 'אדלר', gender: 'female', created_by: 'demo' },
  { id: 'a03', first_name: 'רואי נתן', last_name: 'אדלר', gender: 'male', created_by: 'demo' },

  // ═══════════════════════════════════════════
  // דור 2 – ילדי נתנאל ואדל רות
  // ═══════════════════════════════════════════
  { id: 'm01', first_name: 'דוד מאיר', last_name: 'אדלר', gender: 'male', created_by: 'demo' },
  { id: 'm02', first_name: 'רוני הדסה', last_name: 'אדלר', gender: 'female', created_by: 'demo' },
  { id: 'm03', first_name: 'נטע הודיה', last_name: 'אדלר', gender: 'female', created_by: 'demo' },
  { id: 'm04', first_name: 'סיניי ישראל', last_name: 'אדלר', gender: 'male', created_by: 'demo' },

  // ═══════════════════════════════════════════
  // דור 2 – ילדי רבקה הניה ואברהם עמית
  // ═══════════════════════════════════════════
  { id: 'r01', first_name: 'יחזקאל', last_name: 'עמית', gender: 'male', nickname: 'חזקי', created_by: 'demo' },
  { id: 'r02', first_name: 'רפאל ידידיה', last_name: 'עמית', gender: 'male', nickname: 'ידידיה', created_by: 'demo' },
  { id: 'r03', first_name: 'מרים אלישבע נחמה', last_name: 'עמית', gender: 'female', created_by: 'demo' },
  { id: 'r04', first_name: 'אסתר מלכה', last_name: 'עמית', gender: 'female', created_by: 'demo' },
  { id: 'r05', first_name: 'יהודית פרומט', last_name: 'עמית', gender: 'female', created_by: 'demo' },
  { id: 'r06', first_name: 'דבורה רחל', last_name: 'עמית', gender: 'female', created_by: 'demo' },
  { id: 'r07', first_name: 'אביגיל ברכה', last_name: 'עמית', gender: 'female', created_by: 'demo' },
  { id: 'r08', first_name: 'בת ציון', last_name: 'עמית', gender: 'female', created_by: 'demo' },
  { id: 'r09', first_name: 'יעקב אהרן', last_name: 'עמית', gender: 'male', created_by: 'demo' },
  { id: 'r10', first_name: 'נחום אליהו', last_name: 'עמית', gender: 'male', created_by: 'demo' },

  // ── בני/בנות זוג – ענף רבקה הניה ──
  { id: 'rs1', first_name: 'שרה', last_name: 'עמית', gender: 'female', created_by: 'demo' },          // אשת r01 (חזקי)
  { id: 'rs2', first_name: 'שרה', last_name: 'איילה', gender: 'female', created_by: 'demo' },         // אשת r02 (ידידיה)
  { id: 'rs3', first_name: '—', last_name: 'להשלים', gender: 'male', bio: 'שם להשלים', created_by: 'demo' }, // בעל r03 (מרים)

  // ── דור 3 – ילדי חזקי (r01) ושרה עמית (rs1) ──
  { id: 'rg1', first_name: 'חנה', last_name: 'עמית', gender: 'female', created_by: 'demo' },
  { id: 'rg2', first_name: 'חיים שאול', last_name: 'עמית', gender: 'male', created_by: 'demo' },
  { id: 'rg3', first_name: 'יעקב אהרון', last_name: 'עמית', gender: 'male', created_by: 'demo' },

  // ── דור 3 – ילדי ידידיה (r02) ושרה איילה (rs2) ──
  { id: 'rg4', first_name: 'דוד', last_name: 'עמית', gender: 'male', created_by: 'demo' },
  { id: 'rg5', first_name: 'יהודית', last_name: 'עמית', gender: 'female', created_by: 'demo' },

  // ═══════════════════════════════════════════
  // דור 2 – ילדי צבי אריה וברכה נרי שרה
  // ═══════════════════════════════════════════
  { id: 'z01', first_name: 'רחל לאה', last_name: 'אדלר', gender: 'female', nickname: 'רחלי', created_by: 'demo' },
  { id: 'z02', first_name: 'הניה', last_name: 'אדלר', gender: 'female', created_by: 'demo' },
  { id: 'z03', first_name: 'יחזקאל', last_name: 'אדלר', gender: 'male', nickname: 'חזקי', created_by: 'demo' },
  { id: 'z04', first_name: 'אלישבע אסתר', last_name: 'אדלר', gender: 'female', created_by: 'demo' },
  { id: 'z05', first_name: 'דוד', last_name: 'אדלר', gender: 'male', created_by: 'demo' },
  { id: 'z06', first_name: 'יעקב אהרן', last_name: 'אדלר', gender: 'male', created_by: 'demo' },
  { id: 'z07', first_name: 'ישראל נחמן', last_name: 'אדלר', gender: 'male', created_by: 'demo' },
  { id: 'z08', first_name: 'אביגיל', last_name: 'אדלר', gender: 'female', created_by: 'demo' },
  { id: 'z09', first_name: 'נתן יששכר', last_name: 'אדלר', gender: 'male', created_by: 'demo' },

  // ── בני/בנות זוג – ענף צבי אריה ──
  { id: 'zs1', first_name: 'שמחה', last_name: 'קוסמן', gender: 'male', created_by: 'demo' },             // בעל z01
  { id: 'zs2', first_name: 'יוסי', last_name: 'פאשקר', gender: 'male', created_by: 'demo' },             // בעל z02
  { id: 'zs3', first_name: 'דוד', last_name: 'להשלים', gender: 'male', bio: 'שם משפחה להשלים', created_by: 'demo' }, // בעל z04

  // ── דור 3 – ילדי רחל לאה (z01) ושמחה קוסמן (zs1) ──
  { id: 'zg1', first_name: 'חיה ליבע', last_name: 'קוסמן', gender: 'female', created_by: 'demo' },
]

// ─────────────────────────────────────────────
// קשרים
// ─────────────────────────────────────────────

let _rid = 0
function rel(a: string, b: string, type: Relationship['type'] = 'parent-child'): Relationship {
  return { id: `rel${++_rid}`, member_a_id: a, member_b_id: b, type }
}

export const ADLER_RELATIONSHIPS: Relationship[] = [

  // ── זוג – דור 0 ──
  rel('g01', 'g02', 'spouse'),

  // ── הורים → ילדי יצחק ושולמית ──
  rel('g01', 'c01'), rel('g01', 'c02'), rel('g01', 'c03'),
  rel('g01', 'c04'), rel('g01', 'c05'), rel('g01', 'c06'), rel('g01', 'c07'),
  rel('g02', 'c01'), rel('g02', 'c02'), rel('g02', 'c03'),
  rel('g02', 'c04'), rel('g02', 'c05'), rel('g02', 'c06'), rel('g02', 'c07'),

  // ── זוגות – דור 1 ──
  rel('c01', 's01', 'spouse'),
  rel('c01', 's02', 'spouse'),
  rel('c02', 's03', 'spouse'),
  rel('c03', 's04', 'spouse'),
  rel('c04', 's05', 'spouse'),
  rel('c05', 's06', 'spouse'),
  rel('c06', 's07', 'spouse'),
  rel('c07', 's08', 'spouse'),

  // ── ילדי לאה צירל + נתנאל ──
  rel('c01', 'l01'), rel('c01', 'l02'), rel('c01', 'l03'),
  rel('s01', 'l01'), rel('s01', 'l02'), rel('s01', 'l03'),

  // ── ילדי אליאס אקריב (בנות חורגות – אמא חורגת: לאה צירל) ──
  rel('s02', 'l04'), rel('s02', 'l05'),

  // ── שלומי וולמן + שיר ──
  rel('l04', 'ls1', 'spouse'),

  // ── ילדי נחמה שיינדל ועמית פרקש ──
  rel('c02', 'n01'), rel('c02', 'n02'), rel('c02', 'n03'), rel('c02', 'n04'),
  rel('c02', 'n05'), rel('c02', 'n06'), rel('c02', 'n07'), rel('c02', 'n08'),
  rel('s03', 'n01'), rel('s03', 'n02'), rel('s03', 'n03'), rel('s03', 'n04'),
  rel('s03', 'n05'), rel('s03', 'n06'), rel('s03', 'n07'), rel('s03', 'n08'),

  // ── ילדי יחזקאל ולימור ──
  rel('c03', 'y01'), rel('c03', 'y02'), rel('c03', 'y03'), rel('c03', 'y04'),
  rel('s04', 'y01'), rel('s04', 'y02'), rel('s04', 'y03'), rel('s04', 'y04'),

  // ── ילדי אברהם אליעזר וחנה מזל ──
  rel('c04', 'a01'), rel('c04', 'a02'), rel('c04', 'a03'),
  rel('s05', 'a01'), rel('s05', 'a02'), rel('s05', 'a03'),

  // ── ילדי נתנאל ואדל רות ──
  rel('c05', 'm01'), rel('c05', 'm02'), rel('c05', 'm03'), rel('c05', 'm04'),
  rel('s06', 'm01'), rel('s06', 'm02'), rel('s06', 'm03'), rel('s06', 'm04'),

  // ── ילדי רבקה הניה ואברהם עמית ──
  rel('c06', 'r01'), rel('c06', 'r02'), rel('c06', 'r03'), rel('c06', 'r04'),
  rel('c06', 'r05'), rel('c06', 'r06'), rel('c06', 'r07'), rel('c06', 'r08'),
  rel('c06', 'r09'), rel('c06', 'r10'),
  rel('s07', 'r01'), rel('s07', 'r02'), rel('s07', 'r03'), rel('s07', 'r04'),
  rel('s07', 'r05'), rel('s07', 'r06'), rel('s07', 'r07'), rel('s07', 'r08'),
  rel('s07', 'r09'), rel('s07', 'r10'),

  // ── זוגות + ילדים – ענף רבקה הניה ──
  rel('r01', 'rs1', 'spouse'),
  rel('r01', 'rg1'), rel('r01', 'rg2'), rel('r01', 'rg3'),
  rel('rs1', 'rg1'), rel('rs1', 'rg2'), rel('rs1', 'rg3'),

  rel('r02', 'rs2', 'spouse'),
  rel('r02', 'rg4'), rel('r02', 'rg5'),
  rel('rs2', 'rg4'), rel('rs2', 'rg5'),

  rel('r03', 'rs3', 'spouse'),

  // ── ילדי צבי אריה וברכה נרי שרה ──
  rel('c07', 'z01'), rel('c07', 'z02'), rel('c07', 'z03'), rel('c07', 'z04'),
  rel('c07', 'z05'), rel('c07', 'z06'), rel('c07', 'z07'), rel('c07', 'z08'), rel('c07', 'z09'),
  rel('s08', 'z01'), rel('s08', 'z02'), rel('s08', 'z03'), rel('s08', 'z04'),
  rel('s08', 'z05'), rel('s08', 'z06'), rel('s08', 'z07'), rel('s08', 'z08'), rel('s08', 'z09'),

  // ── זוגות + ילדים – ענף צבי אריה ──
  rel('z01', 'zs1', 'spouse'),
  rel('z01', 'zg1'), rel('zs1', 'zg1'),

  rel('z02', 'zs2', 'spouse'),

  rel('z04', 'zs3', 'spouse'),
]
