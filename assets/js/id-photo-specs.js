/* =====================================================================
   Moteful 证件照工具 · 规格库数据（id-photo-specs.js）
   独立数据文件：与功能引擎解耦，规格更新只改本文件
   载体：window.ID_PHOTO_SPECS = { meta, items }
   像素值按公式 px = mm ÷ 25.4 × DPI 计算（四舍五入取整），下表 pxW/pxH 为 @300DPI 参考值
   ===================================================================== */
window.ID_PHOTO_SPECS = {
  meta: {
    source: '行业通用口径 + 用户提供；官方文件链接/文号属"待核验"项，上线前逐项回填（禁止凭印象编造文号）',
    updated: '2026-10-02（数值按 DPI 公式复核一致；官方来源核验待回填）',
    disclaimer: {
      zh: '证件规格可能随官方要求调整，本站规格库仅供排版参考；实际办理请以受理机构 / 官方最新要求为准。',
      en: 'Photo specifications may change with official requirements. This library is for layout reference only; please follow the latest requirements of the issuing authority.'
    }
  },
  items: {
    cun1: {
      name: { zh: '一寸', en: 'One-inch' },
      mmW: 25, mmH: 35, pxW: 295, pxH: 413, dpi: 300,
      uses: { zh: '中国证件照通用（身份证/社保/简历）', en: 'Common Chinese ID photo (ID card, social security, resume)' }
    },
    cun1s: {
      name: { zh: '小一寸', en: 'Small one-inch' },
      mmW: 22, mmH: 32, pxW: 260, pxH: 378, dpi: 300,
      uses: { zh: '驾驶证/部分报名表', en: "Driver's license, some application forms" }
    },
    cun1b: {
      name: { zh: '大一寸', en: 'Large one-inch' },
      mmW: 33, mmH: 48, pxW: 390, pxH: 567, dpi: 300,
      uses: { zh: '护照/港澳通行证（部分地区）', en: 'Passport, HK/Macau pass (some regions)' }
    },
    cun2: {
      name: { zh: '二寸', en: 'Two-inch' },
      mmW: 35, mmH: 49, pxW: 413, pxH: 579, dpi: 300,
      uses: { zh: '毕业证/学位证/签证通用', en: 'Diploma, degree, general visa' }
    },
    cun2s: {
      name: { zh: '小二寸', en: 'Small two-inch' },
      mmW: 35, mmH: 45, pxW: 413, pxH: 531, dpi: 300,
      uses: { zh: '部分签证/登记照', en: 'Some visas, registration photos' }
    },
    cun2b: {
      name: { zh: '大二寸', en: 'Large two-inch' },
      mmW: 35, mmH: 53, pxW: 413, pxH: 626, dpi: 300,
      uses: { zh: '部分公务员/资格考试报名', en: 'Some civil service / exam registrations' }
    },
    w5: {
      name: { zh: '五寸', en: 'Five-inch' },
      mmW: 89, mmH: 127, pxW: 1051, pxH: 1500, dpi: 300,
      uses: { zh: '生活照/印刷', en: 'Life photos, printing' }
    },
    cnid: {
      name: { zh: '中国证件', en: 'China ID photo' },
      mmW: 26, mmH: 32, pxW: 307, pxH: 378, dpi: 300,
      uses: { zh: '中国居民身份证相片', en: 'Chinese resident ID card photo' }
    },
    marriage: {
      name: { zh: '结婚照', en: 'Marriage photo' },
      mmW: 40, mmH: 60, pxW: 472, pxH: 709, dpi: 300,
      uses: { zh: '结婚登记照', en: 'Marriage registration photo' }
    },
    us: {
      name: { zh: '美签', en: 'US visa' },
      mmW: 51, mmH: 51, pxW: 602, pxH: 602, dpi: 300,
      uses: { zh: '美国签证照片', en: 'US visa photo' }
    },
    jp: {
      name: { zh: '日签', en: 'Japan visa' },
      mmW: 45, mmH: 45, pxW: 531, pxH: 531, dpi: 300,
      uses: { zh: '日本签证照片', en: 'Japan visa photo' }
    },
    sc: {
      name: { zh: '申根', en: 'Schengen' },
      mmW: 35, mmH: 45, pxW: 413, pxH: 531, dpi: 300,
      uses: { zh: '申根签证照片', en: 'Schengen visa photo' }
    }
  }
};
