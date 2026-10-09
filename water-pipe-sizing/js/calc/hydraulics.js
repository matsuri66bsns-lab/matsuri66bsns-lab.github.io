/*
 * 水理計算（ヘーゼン・ウィリアムス式）
 *   h/L = 10.666 · C^-1.852 · D^-4.87 · Q^1.852   [m/m]  (Q: m³/s, D: m)
 * 圧力は kPa、水の単位体積重量は ρg = 9.80665 kPa/m とする。
 */
(function (WPS) {
  'use strict';

  const G = 9.80665;

  function frictionKPaPerM(qLpm, dMm, C) {
    if (!(qLpm > 0) || !(dMm > 0) || !(C > 0)) return 0;
    const Q = qLpm / 60000;
    const D = dMm / 1000;
    return 10.666 * Math.pow(C, -1.852) * Math.pow(D, -4.87) * Math.pow(Q, 1.852) * G;
  }

  function velocity(qLpm, dMm) {
    if (!(qLpm > 0) || !(dMm > 0)) return 0;
    const Q = qLpm / 60000;
    const D = dMm / 1000;
    return Q / (Math.PI * D * D / 4);
  }

  WPS.hyd = {
    G,
    frictionKPaPerM,
    velocity,
    staticKPa(dzM) { return dzM * G; },
  };
})(globalThis.WPS = globalThis.WPS || {});
