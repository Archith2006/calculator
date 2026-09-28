const STORAGE_KEY = 'infinity-calculator-history';
const PREVIOUS_STORAGE_KEY = ['for', 'me', '-calculator-history'].join('');
const HISTORY_LIMIT = 100;

const state = {
  view: 'basic',
  expressions: { basic: '', scientific: '' },
  answers: { basic: '0', scientific: '0' },
  previousAnswers: { basic: 0, scientific: 0 },
  history: loadHistory(),
  memory: 0,
  hasMemory: false,
  angleMode: 'deg',
  scientificFraction: null
};
let baseHistoryTimer;
let lastSavedBaseConversion = '';

const unitSets = {
  length: { units: { m: 1, km: 1000, cm: .01, mm: .001, mi: 1609.344, yd: .9144, ft: .3048, in: .0254 }, labels: { m: 'Meters', km: 'Kilometers', cm: 'Centimeters', mm: 'Millimeters', mi: 'Miles', yd: 'Yards', ft: 'Feet', in: 'Inches' } },
  weight: { units: { kg: 1, g: .001, mg: .000001, lb: .45359237, oz: .028349523125, st: 6.35029318 }, labels: { kg: 'Kilograms', g: 'Grams', mg: 'Milligrams', lb: 'Pounds', oz: 'Ounces', st: 'Stones' } },
  speed: { units: { 'm/s': 1, 'km/h': 1 / 3.6, mph: .44704, knot: .514444 }, labels: { 'm/s': 'Meters per second', 'km/h': 'Kilometers per hour', mph: 'Miles per hour', knot: 'Knots' } },
  currency: { units: { USD: 1, EUR: .92, GBP: .79, JPY: 149.5, CAD: 1.36, AUD: 1.52, INR: 83.1 }, labels: { USD: 'US Dollar', EUR: 'Euro', GBP: 'British Pound', JPY: 'Japanese Yen', CAD: 'Canadian Dollar', AUD: 'Australian Dollar', INR: 'Indian Rupee' } }
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function loadHistory() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || localStorage.getItem(PREVIOUS_STORAGE_KEY) || '[]');
    if (Array.isArray(saved) && !localStorage.getItem(STORAGE_KEY)) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
      localStorage.removeItem(PREVIOUS_STORAGE_KEY);
    }
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function saveHistory() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.history)); } catch { /* Storage may be unavailable in private browsing. */ }
}

function renderHistory() {
  const list = $('#history-list');
  list.replaceChildren();
  $('#empty-history').hidden = state.history.length > 0;
  $('#clear-history').hidden = state.history.length === 0;
  $('#history-count').textContent = state.history.length;
  state.history.forEach((item, index) => {
    const row = document.createElement('article');
    row.className = 'history-item';
    const details = document.createElement('div');
    const expression = document.createElement('div');
    expression.className = 'history-expression';
    expression.textContent = item.expression;
    const result = document.createElement('div');
    result.className = 'history-result';
    result.textContent = `= ${item.result}`;
    const time = document.createElement('div');
    time.className = 'history-time';
    time.textContent = `${item.mode} · ${new Date(item.timestamp).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`;
    details.append(expression, result, time);
    const actions = document.createElement('div');
    actions.className = 'history-actions';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = '⧉';
    copy.title = 'Copy result';
    copy.setAttribute('aria-label', 'Copy result');
    copy.addEventListener('click', () => copyText(item.result, copy));
    const reuse = document.createElement('button');
    reuse.type = 'button';
    reuse.textContent = '↩';
    reuse.title = 'Reuse expression';
    reuse.setAttribute('aria-label', 'Reuse expression');
    reuse.addEventListener('click', () => reuseHistoryItem(item));
    actions.append(copy, reuse);
    row.append(details, actions);
    row.style.animationDelay = `${Math.min(index, 8) * 25}ms`;
    list.append(row);
  });
}

function recordHistory(expression, result, mode) {
  state.history.unshift({ expression, result: String(result), mode, timestamp: Date.now() });
  state.history = state.history.slice(0, HISTORY_LIMIT);
  saveHistory();
  renderHistory();
}

function setView(view) {
  state.view = view;
  $$('.view').forEach(section => {
    const active = section.id === `view-${view}`;
    section.hidden = !active;
    section.classList.toggle('active', active);
  });
  $$('.nav-item').forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  $('#page-title').textContent = view[0].toUpperCase() + view.slice(1);
  if (view === 'history') renderHistory();
  if (view === 'basic' || view === 'scientific') refreshCalculator(view);
}

function calculatorMode() {
  return state.view === 'scientific' ? 'scientific' : 'basic';
}

function normalizeExpression(expression) {
  return expression
    .replace(/([+\-−]?\d+(?:\.\d+)?)\s*nPr\s*([+\-−]?\d+(?:\.\d+)?)/gi, 'nPr($1,$2)')
    .replace(/([+\-−]?\d+(?:\.\d+)?)\s*nCr\s*([+\-−]?\d+(?:\.\d+)?)/gi, 'nCr($1,$2)')
    .replaceAll('×', '*').replaceAll('÷', '/').replaceAll('−', '-')
    .replace(/(\d+(?:\.\d+)?)%/g, '($1/100)');
}

function countArrangements(n, r, combination) {
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(r) || n < 0 || r < 0) {
    throw new Error('nPr/nCr require non-negative whole numbers.');
  }
  if (r > n) throw new Error('nPr/nCr require r to be less than or equal to n.');
  const terms = combination ? Math.min(r, n - r) : r;
  if (terms > 10000) throw new Error('nPr/nCr result is too large to calculate safely.');
  let result = 1;
  for (let index = 0; index < terms; index += 1) {
    result *= combination ? (n - terms + index + 1) / (index + 1) : n - index;
    if (!Number.isFinite(result)) throw new Error('nPr/nCr result is too large to display.');
  }
  return result;
}

function gcd(left, right) {
  left = Math.abs(left);
  right = Math.abs(right);
  while (right) [left, right] = [right, left % right];
  return left || 1;
}

function reduceFraction(numerator, denominator) {
  if (denominator === 0) throw new Error('Undefined');
  if (denominator < 0) { numerator = -numerator; denominator = -denominator; }
  const divisor = gcd(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

function decimalToFraction(value, expression = '') {
  if (!Number.isFinite(value)) throw new Error('Undefined');
  const sign = value < 0 ? -1 : 1;
  const target = Math.abs(value);
  if (Number.isInteger(target)) return { ...reduceFraction(sign * target, 1), approximate: false };

  const decimalInput = expression.match(/^\s*-?\d+\.(\d+)\s*$/);
  const tolerance = decimalInput ? Math.max(1e-9, .5 * 10 ** -decimalInput[1].length) : 1e-9;
  const maxDenominator = 1_000_000_000;
  let remainder = target;
  let hMinusTwo = 0;
  let hMinusOne = 1;
  let kMinusTwo = 1;
  let kMinusOne = 0;
  let numerator = Math.round(target);
  let denominator = 1;

  for (let iteration = 0; iteration < 100; iteration += 1) {
    const coefficient = Math.floor(remainder);
    const nextNumerator = coefficient * hMinusOne + hMinusTwo;
    const nextDenominator = coefficient * kMinusOne + kMinusTwo;
    if (!Number.isSafeInteger(nextNumerator) || nextDenominator > maxDenominator) break;
    numerator = nextNumerator;
    denominator = nextDenominator;
    if (Math.abs(numerator / denominator - target) <= tolerance) break;
    const fractionalPart = remainder - coefficient;
    if (fractionalPart < 1e-15) break;
    hMinusTwo = hMinusOne;
    hMinusOne = numerator;
    kMinusTwo = kMinusOne;
    kMinusOne = denominator;
    remainder = 1 / fractionalPart;
  }

  const fraction = reduceFraction(sign * numerator, denominator);
  fraction.approximate = /\bpi\b|π/i.test(expression) || Math.abs(fraction.numerator / fraction.denominator - value) > 1e-9;
  return fraction;
}

function fractionText(fraction) {
  return fraction.denominator === 1 ? String(fraction.numerator) : `${fraction.numerator}/${fraction.denominator}`;
}

function fractionDetail(fraction) {
  const parts = [];
  const whole = Math.trunc(fraction.numerator / fraction.denominator);
  const remainder = Math.abs(fraction.numerator % fraction.denominator);
  if (whole && remainder) parts.push(`Mixed number: ${whole} ${remainder}/${fraction.denominator}`);
  if (fraction.approximate) parts.push('Approximate fraction');
  return parts.join(' · ');
}

function showFractionDetail(fraction) {
  const detail = $('#scientific-fraction-detail');
  const text = fractionDetail(fraction);
  detail.textContent = text;
  detail.hidden = !text;
}

function toggleFractionDecimal() {
  if ($('#scientific-result').classList.contains('error')) return;
  let fraction = state.scientificFraction;
  if (!fraction) {
    const expression = state.expressions.scientific.trim();
    if (!expression) return;
    try {
      const value = Number(math.evaluate(normalizeExpression(expression), trigScope()));
      fraction = { ...decimalToFraction(value, expression), decimal: value, display: 'decimal' };
    } catch {
      showError('scientific', 'Enter a valid value first');
      return;
    }
  }

  if (fraction.display === 'fraction') {
    fraction.display = 'decimal';
    const decimal = fraction.decimal ?? fraction.numerator / fraction.denominator;
    $('#scientific-result').textContent = math.format(decimal, { precision: 10 });
    showFractionDetail(fraction);
    recordHistory(state.expressions.scientific, $('#scientific-result').textContent, 'Scientific');
  } else {
    if (fraction.numerator === undefined) fraction = { ...fraction, ...decimalToFraction(fraction.decimal, state.expressions.scientific) };
    fraction.display = 'fraction';
    $('#scientific-result').textContent = fractionText(fraction);
    showFractionDetail(fraction);
    recordHistory(state.expressions.scientific, `${fractionText(fraction)}${fractionDetail(fraction) ? ` · ${fractionDetail(fraction)}` : ''}`, 'Scientific');
  }
  state.scientificFraction = fraction;
}

function trigScope() {
  const angle = value => state.angleMode === 'deg' ? value * Math.PI / 180 : value;
  const inverse = value => state.angleMode === 'deg' ? value * 180 / Math.PI : value;
  const reciprocal = (fn, value) => 1 / fn(angle(value));
  return {
    ans: Number(state.previousAnswers[calculatorMode()]),
    nPr: (n, r) => countArrangements(n, r, false),
    nCr: (n, r) => countArrangements(n, r, true),
    cosec: value => reciprocal(Math.sin, value),
    csc: value => reciprocal(Math.sin, value),
    sec: value => reciprocal(Math.cos, value),
    cot: value => reciprocal(Math.tan, value),
    acosec: value => inverse(Math.asin(1 / value)),
    acsc: value => inverse(Math.asin(1 / value)),
    asec: value => inverse(Math.acos(1 / value)),
    acot: value => inverse(Math.atan(1 / value)),
    sin: value => Math.sin(angle(value)),
    cos: value => Math.cos(angle(value)),
    tan: value => Math.tan(angle(value)),
    asin: value => inverse(Math.asin(value)),
    acos: value => inverse(Math.acos(value)),
    atan: value => inverse(Math.atan(value))
  };
}

function formatNumber(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Result is undefined');
    if (Math.abs(value) < 1e-12) value = 0;
    return math.format(value, { precision: 12 });
  }
  return String(value);
}

function calculate(mode = calculatorMode()) {
  const expression = state.expressions[mode].trim();
  if (!expression) return;
  try {
    const directFraction = mode === 'scientific'
      ? expression.replaceAll('−', '-').replaceAll('÷', '/').match(/^\s*([+-]?\d+)\s*\/\s*([+-]?\d+)\s*$/)
      : null;
    if (directFraction && Number(directFraction[2]) === 0) throw new Error('Undefined');
    const result = math.evaluate(normalizeExpression(expression), trigScope());
    const formatted = directFraction
      ? fractionText(reduceFraction(Number(directFraction[1]), Number(directFraction[2])))
      : formatNumber(result);
    state.answers[mode] = formatted;
    state.previousAnswers[mode] = Number(result);
    if (mode === 'scientific') {
      state.scientificFraction = directFraction
        ? { ...reduceFraction(Number(directFraction[1]), Number(directFraction[2])), decimal: Number(result), display: 'fraction', approximate: false }
        : { ...decimalToFraction(Number(result), expression), decimal: Number(result), display: 'decimal' };
      showFractionDetail(state.scientificFraction);
    }
    recordHistory(expression, formatted, mode === 'basic' ? 'Basic' : 'Scientific');
    refreshCalculator(mode, formatted);
  } catch (error) {
    const message = error.message === 'Undefined' ? 'Undefined' : error.message.startsWith('nPr/nCr') ? error.message : error.message.includes('undefined') ? 'Cannot divide by zero' : 'Invalid expression';
    if (mode === 'scientific') {
      state.scientificFraction = null;
      showFractionDetail({ numerator: 0, denominator: 1 });
    }
    showError(mode, message);
  }
}

function showError(mode, message) {
  const result = $(`#${mode}-result`);
  result.textContent = message;
  result.classList.add('error');
}

function refreshCalculator(mode, resultText) {
  $(`#${mode}-expression`).textContent = state.expressions[mode];
  const result = $(`#${mode}-result`);
  result.classList.remove('error');
  if (resultText !== undefined) result.textContent = resultText;
  else if (!state.expressions[mode]) result.textContent = '0';
  else if (mode === 'scientific' && state.scientificFraction) {
    const fraction = state.scientificFraction;
    result.textContent = fraction.display === 'fraction' ? fractionText(fraction) : formatNumber(fraction.decimal);
    showFractionDetail(fraction);
  }
  else {
    try {
      const preview = math.evaluate(normalizeExpression(state.expressions[mode]), trigScope());
      result.textContent = formatNumber(preview);
    } catch { result.textContent = state.answers[mode] || '0'; }
  }
}

function insertText(value) {
  const mode = calculatorMode();
  if (mode === 'scientific') {
    state.scientificFraction = null;
    $('#scientific-fraction-detail').hidden = true;
  }
  state.expressions[mode] += value;
  refreshCalculator(mode);
}

function clearCalculator() {
  const mode = calculatorMode();
  if (mode === 'scientific') {
    state.scientificFraction = null;
    $('#scientific-fraction-detail').hidden = true;
  }
  state.expressions[mode] = '';
  state.answers[mode] = '0';
  refreshCalculator(mode);
}

function backspace() {
  const mode = calculatorMode();
  if (mode === 'scientific') {
    state.scientificFraction = null;
    $('#scientific-fraction-detail').hidden = true;
  }
  state.expressions[mode] = state.expressions[mode].slice(0, -1);
  refreshCalculator(mode);
}

function copyText(value, button) {
  const copied = () => {
    const previous = button.textContent;
    button.textContent = '✓';
    setTimeout(() => { button.textContent = previous; }, 1000);
  };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(value).then(copied).catch(() => fallbackCopy(value, copied));
  else fallbackCopy(value, copied);
}

function fallbackCopy(value, done) {
  const input = document.createElement('textarea');
  input.value = value;
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.append(input);
  input.select();
  document.execCommand('copy');
  input.remove();
  done();
}

function reuseHistoryItem(item) {
  if (item.mode === 'Calculus') {
    const match = item.expression.match(/^(?:d\/d|∫)([a-z])\s*\((.*)\)$/i);
    if (match) {
      setView('calculus');
      $('#calculus-input').value = match[2];
      $('#calculus-variable').value = match[1];
      $('#calculus-operation').value = item.expression.startsWith('∫') ? 'integrate' : 'differentiate';
      return;
    }
  }
  if (item.mode === 'Complex') {
    const match = item.expression.match(/^(add|subtract|multiply|divide|modulus|conjugate|argument):\s*\((.*),\s*(.*)\)$/i);
    if (match) {
      setView('complex');
      $('#complex-operation').value = match[1].toLowerCase();
      $('#complex-a').value = match[2];
      $('#complex-b').value = match[3];
      return;
    }
  }
  if (item.mode === 'Vectors') {
    const match = item.expression.match(/^(add|subtract|dot|cross|magnitude|normalize):\s*\((.*)\);\s*\((.*)\)$/i);
    if (match) {
      setView('vectors');
      $('#vector-operation').value = match[1].toLowerCase();
      $('#vector-a').value = match[2];
      $('#vector-b').value = match[3];
      const dimension = match[2].split(',').length;
      $('#vector-dimension').value = String(dimension);
      return;
    }
  }
  if (item.mode === 'Number Base') {
    const match = item.expression.match(/^base (2|8|10|16):\s*(.+)$/i);
    if (match) {
      setView('bases');
      $('#base-from').value = match[1];
      $('#base-input').value = match[2];
      updateBaseOutputs();
      return;
    }
  }
  if (item.mode === 'Equations') {
    setView('equations');
    $('#equation-input').value = item.expression;
    return;
  }
  if (item.mode === 'Matrix') {
    const match = item.expression.match(/^matrix:(add|subtract|multiply|transpose|determinant|inverse|rank):(.*)$/i);
    if (match) {
      setView('matrix');
      $('#matrix-operation').value = match[1].toLowerCase();
      try {
        const payload = JSON.parse(match[2]);
        const rows = payload.a.length;
        const columns = payload.a[0]?.length || 1;
        $('#matrix-rows').value = rows;
        $('#matrix-columns').value = columns;
        $('#matrix-b-rows').value = payload.b?.length || rows;
        $('#matrix-b-columns').value = payload.b?.[0]?.length || columns;
        buildMatrixGrids();
        populateMatrixGrid('a', payload.a);
        if (payload.b) populateMatrixGrid('b', payload.b);
      } catch { /* Older or invalid matrix history remains available to copy. */ }
      return;
    }
  }
  const mode = item.mode.toLowerCase() === 'scientific' ? 'scientific' : 'basic';
  if (mode === 'scientific') {
    state.scientificFraction = null;
    $('#scientific-fraction-detail').hidden = true;
  }
  setView(mode);
  state.expressions[mode] = item.expression;
  refreshCalculator(mode);
}

function toggleAngleMode() {
  state.angleMode = state.angleMode === 'deg' ? 'rad' : 'deg';
  $$('.angle-toggle').forEach(button => { button.textContent = state.angleMode.toUpperCase(); });
  $$('.inline-angle').forEach(button => { button.textContent = state.angleMode === 'deg' ? 'degrees' : 'radians'; });
  refreshCalculator('scientific');
  refreshCalculator('basic');
}

function setupConverter() {
  const category = $('#category-select').value;
  let units = unitSets[category]?.units;
  let labels = unitSets[category]?.labels;
  if (category === 'temperature') {
    units = { C: 0, F: 0, K: 0 };
    labels = { C: 'Celsius', F: 'Fahrenheit', K: 'Kelvin' };
  }
  const from = $('#from-unit');
  const to = $('#to-unit');
  const previousFrom = from.value;
  const previousTo = to.value;
  from.replaceChildren();
  to.replaceChildren();
  Object.keys(units).forEach(code => {
    const makeOption = () => {
      const option = document.createElement('option');
      option.value = code;
      option.textContent = labels[code];
      return option;
    };
    from.append(makeOption());
    to.append(makeOption());
  });
  from.value = units[previousFrom] !== undefined ? previousFrom : Object.keys(units)[0];
  to.value = units[previousTo] !== undefined && previousTo !== from.value ? previousTo : Object.keys(units)[1] || Object.keys(units)[0];
  $('#rate-note').hidden = category !== 'currency';
  updateConversion();
}

function convertTemperature(value, from, to) {
  const celsius = from === 'C' ? value : from === 'F' ? (value - 32) * 5 / 9 : value - 273.15;
  return to === 'C' ? celsius : to === 'F' ? celsius * 9 / 5 + 32 : celsius + 273.15;
}

function updateConversion() {
  const category = $('#category-select').value;
  const from = $('#from-unit').value;
  const to = $('#to-unit').value;
  const value = Number($('#convert-input').value || 0);
  let result;
  if (category === 'temperature') result = convertTemperature(value, from, to);
  else {
    const units = unitSets[category].units;
    result = category === 'currency' ? value / units[from] * units[to] : value * units[from] / units[to];
  }
  const formatted = Number.isFinite(result) ? math.format(result, { precision: 10 }) : '—';
  $('#convert-result').textContent = formatted;
  const fromLabel = $('#from-unit').selectedOptions[0]?.textContent || from;
  const toLabel = $('#to-unit').selectedOptions[0]?.textContent || to;
  $('#conversion-summary').textContent = `${$('#convert-input').value || 0} ${fromLabel.toLowerCase()} = ${formatted} ${toLabel.toLowerCase()}`;
}

function calculateCalculus() {
  const expression = $('#calculus-input').value.trim();
  const variable = $('#calculus-variable').value.trim() || 'x';
  const operation = $('#calculus-operation').value;
  const output = $('#calculus-output');
  try {
    if (!expression || !/^[a-z]$/i.test(variable)) throw new Error('Enter an expression and a single-letter variable.');
    const normalizedExpression = expression.replace(/\bln\s*\(/gi, 'log(');
    const answer = operation === 'differentiate' ? math.derivative(normalizedExpression, variable).toString() : nerdamer.integrate(normalizedExpression, variable).toString();
    if (operation === 'integrate' && /integrate\s*\(/i.test(answer)) throw new Error('Cannot simplify further with the available integral rules.');
    const simplified = nerdamer(answer).toString();
    const result = operation === 'differentiate' ? `d/d${variable} (${expression}) = ${simplified}` : `∫ (${expression}) d${variable} = ${simplified} + C`;
    output.querySelector('strong').textContent = result;
    output.querySelector('.output-label').textContent = 'YOUR RESULT';
    output.querySelector('.output-note').textContent = operation === 'integrate' ? 'A constant of integration (+ C) is included.' : 'Symbolically differentiated and simplified.';
    recordHistory(`${operation === 'differentiate' ? 'd/d' : '∫'}${variable} (${expression})`, simplified + (operation === 'integrate' ? ' + C' : ''), 'Calculus');
  } catch (error) {
    output.querySelector('strong').textContent = operation === 'integrate' ? 'Cannot simplify further with the available integral rules.' : error.message || 'Could not parse that expression.';
    output.querySelector('.output-label').textContent = 'CHECK YOUR EXPRESSION';
    output.querySelector('.output-note').textContent = 'Try a standard expression such as x^2 + 3x, sin(x), or exp(x).';
  }
}

$$('.nav-item').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
$$('[data-switch-mode]').forEach(button => button.addEventListener('click', () => setView(button.dataset.switchMode)));
$$('.keypad').forEach(keypad => keypad.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  const { action, insert } = button.dataset;
  if (action === 'equals') calculate();
  else if (action === 'clear') clearCalculator();
  else if (action === 'backspace') backspace();
  else if (action === 'fraction-toggle') toggleFractionDecimal();
  else if (action === 'sign') insertText('−');
  else if (insert !== undefined) insertText(insert);
}));
$$('.memory-row [data-action="fraction-toggle"]').forEach(button => button.addEventListener('click', toggleFractionDecimal));
$$('[data-action="backspace"]:not(.key)').forEach(button => button.addEventListener('click', backspace));
$$('.angle-toggle').forEach(button => button.addEventListener('click', toggleAngleMode));
$('.inline-angle').addEventListener('click', toggleAngleMode);
$$('[data-memory]').forEach(button => button.addEventListener('click', () => {
  const action = button.dataset.memory;
  const current = Number(state.answers.scientific) || 0;
  if (action === 'clear') { state.memory = 0; state.hasMemory = false; }
  if (action === 'add') { state.memory += current; state.hasMemory = true; }
  if (action === 'subtract') { state.memory -= current; state.hasMemory = true; }
  if (action === 'recall' && state.hasMemory) insertText(String(state.memory));
  $('#memory-status').textContent = state.hasMemory ? `M = ${formatNumber(state.memory)}` : 'MEMORY EMPTY';
  $('#memory-status').classList.toggle('has-memory', state.hasMemory);
}));
$('#theme-toggle').addEventListener('click', () => {
  const dark = document.body.classList.toggle('dark');
  $('.theme-icon').textContent = dark ? '☀' : '☾';
  $('.theme-toggle > span:nth-child(2)').textContent = dark ? 'Light appearance' : 'Dark appearance';
  $('#theme-toggle').setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
});
$('#clear-history').addEventListener('click', () => { state.history = []; saveHistory(); renderHistory(); });
$('#calculus-submit').addEventListener('click', calculateCalculus);
$('#calculus-input').addEventListener('keydown', event => { if (event.key === 'Enter') calculateCalculus(); });
$('#category-select').addEventListener('change', setupConverter);
$('#from-unit').addEventListener('change', updateConversion);
$('#to-unit').addEventListener('change', updateConversion);
$('#convert-input').addEventListener('input', updateConversion);
$('#swap-units').addEventListener('click', () => {
  const from = $('#from-unit');
  const to = $('#to-unit');
  [from.value, to.value] = [to.value, from.value];
  updateConversion();
});

document.addEventListener('keydown', event => {
  if (state.view !== 'basic' && state.view !== 'scientific') return;
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  if (/^[0-9.]$/.test(event.key)) insertText(event.key);
  else if (['+', '-', '*', '/'].includes(event.key)) insertText(({ '*': '×', '/': '÷', '-': '−' })[event.key] || event.key);
  else if (event.key === 'Enter' || event.key === '=') { event.preventDefault(); calculate(); }
  else if (event.key === 'Backspace') backspace();
  else if (event.key === 'Escape') clearCalculator();
  else if (event.key === '(' || event.key === ')' || event.key === '%') insertText(event.key);
});

$('#today-label').textContent = new Date().toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
$('.angle-toggle').textContent = state.angleMode.toUpperCase();
$('.inline-angle').textContent = state.angleMode === 'deg' ? 'degrees' : 'radians';
renderHistory();
setupConverter();

function showToolResult(id, title, detail = '') {
  const output = $(`#${id}`);
  output.querySelector('strong').textContent = title;
  output.querySelector('.output-label').textContent = 'RESULT';
  output.querySelector('.output-note').textContent = detail;
}

function formatComplex(value) {
  const real = Math.abs(value.re) < 1e-12 ? 0 : value.re;
  const imaginary = Math.abs(value.im) < 1e-12 ? 0 : value.im;
  if (imaginary === 0) return math.format(real, { precision: 10 });
  if (real === 0) return `${math.format(imaginary, { precision: 10 })}i`;
  const sign = imaginary < 0 ? ' − ' : ' + ';
  const imaginaryText = Math.abs(imaginary) === 1 ? 'i' : `${math.format(Math.abs(imaginary), { precision: 10 })}i`;
  return `${math.format(real, { precision: 10 })}${sign}${imaginaryText}`;
}

function calculateComplex() {
  const expressionA = $('#complex-a').value.trim();
  const expressionB = $('#complex-b').value.trim();
  const operation = $('#complex-operation').value;
  try {
    const a = math.complex(expressionA);
    const b = ['add', 'subtract', 'multiply', 'divide'].includes(operation) ? math.complex(expressionB) : null;
    let value;
    if (operation === 'add') value = math.add(a, b);
    if (operation === 'subtract') value = math.subtract(a, b);
    if (operation === 'multiply') value = math.multiply(a, b);
    if (operation === 'divide') value = math.divide(a, b);
    if (operation === 'modulus') value = math.abs(a);
    if (operation === 'conjugate') value = math.conj(a);
    if (operation === 'argument') value = Math.atan2(a.im, a.re);
    const result = typeof value === 'number' ? math.format(value, { precision: 10 }) : formatComplex(value);
    showToolResult('complex-output', result, operation === 'argument' ? 'Argument is measured in radians.' : '');
    recordHistory(`${operation}: (${expressionA}, ${expressionB})`, result, 'Complex');
  } catch {
    showToolResult('complex-output', 'Enter valid complex numbers such as 2 + 3i.', 'Division by zero is undefined.');
  }
}

function parseVector(selector, dimension) {
  const values = $(selector).value.split(',').map(value => Number(value.trim()));
  if (values.length !== dimension || values.some(value => !Number.isFinite(value))) throw new Error(`Enter exactly ${dimension} numeric components.`);
  return values;
}

function calculateVector() {
  const dimension = Number($('#vector-dimension').value);
  const operation = $('#vector-operation').value;
  const expressionA = $('#vector-a').value.trim();
  const expressionB = $('#vector-b').value.trim();
  try {
    const a = parseVector('#vector-a', dimension);
    const b = ['add', 'subtract', 'dot', 'cross'].includes(operation) ? parseVector('#vector-b', dimension) : [];
    let value;
    if (operation === 'add') value = a.map((component, index) => component + b[index]);
    if (operation === 'subtract') value = a.map((component, index) => component - b[index]);
    if (operation === 'dot') value = a.reduce((sum, component, index) => sum + component * b[index], 0);
    if (operation === 'cross') {
      if (dimension !== 3) throw new Error('Cross product requires 3D vectors.');
      value = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    }
    if (operation === 'magnitude') value = Math.hypot(...a);
    if (operation === 'normalize') {
      const magnitude = Math.hypot(...a);
      if (magnitude === 0) throw new Error('The zero vector cannot be normalized.');
      value = a.map(component => component / magnitude);
    }
    const result = Array.isArray(value) ? `(${value.map(component => math.format(component, { precision: 10 })).join(', ')})` : math.format(value, { precision: 10 });
    showToolResult('vector-output', result);
    recordHistory(`${operation}: (${expressionA}); (${expressionB})`, result, 'Vectors');
  } catch (error) {
    showToolResult('vector-output', error.message || 'Enter valid vector components.');
  }
}

function parseBaseValue(text, base) {
  const digits = { 2: /^[+-]?[01]+$/, 8: /^[+-]?[0-7]+$/, 10: /^[+-]?\d+$/, 16: /^[+-]?[\da-f]+$/i }[base];
  const cleaned = text.trim();
  if (!digits.test(cleaned)) throw new Error(`That value is not valid in base ${base}.`);
  const negative = cleaned.startsWith('-');
  const unsigned = cleaned.replace(/^[+-]/, '').toLowerCase();
  let value = 0n;
  for (const character of unsigned) value = value * BigInt(base) + BigInt(parseInt(character, base));
  if (negative) value = -value;
  return value;
}

function updateBaseOutputs() {
  const input = $('#base-input').value.trim();
  const base = Number($('#base-from').value);
  try {
    const value = parseBaseValue(input, base);
    [2, 8, 10, 16].forEach(radix => { $(`#base-${radix}`).textContent = value.toString(radix).toUpperCase(); });
    $('#base-feedback').textContent = '';
    return value;
  } catch (error) {
    [2, 8, 10, 16].forEach(radix => { $(`#base-${radix}`).textContent = '—'; });
    $('#base-feedback').textContent = error.message;
    return null;
  }
}

const complexMath = {
  add: (a, b) => ({ re: a.re + b.re, im: a.im + b.im }),
  subtract: (a, b) => ({ re: a.re - b.re, im: a.im - b.im }),
  multiply: (a, b) => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re }),
  divide: (a, b) => {
    const denominator = b.re * b.re + b.im * b.im;
    if (denominator === 0) throw new Error('Division by zero.');
    return { re: (a.re * b.re + a.im * b.im) / denominator, im: (a.im * b.re - a.re * b.im) / denominator };
  },
  scale: (a, scalar) => ({ re: a.re * scalar, im: a.im * scalar }),
  sqrt: a => {
    const magnitude = Math.hypot(a.re, a.im);
    return { re: Math.sqrt(Math.max(0, (magnitude + a.re) / 2)), im: Math.sign(a.im || 1) * Math.sqrt(Math.max(0, (magnitude - a.re) / 2)) };
  },
  cbrt: a => {
    const radius = Math.hypot(a.re, a.im) ** (1 / 3);
    const angle = Math.atan2(a.im, a.re) / 3;
    return { re: radius * Math.cos(angle), im: radius * Math.sin(angle) };
  },
  abs: a => Math.hypot(a.re, a.im)
};

function polynomialCoefficients(expression) {
  const compact = expression.replace(/\s+/g, '').replaceAll('−', '-').replaceAll('–', '-').replaceAll('*', '');
  if (!compact) throw new Error('Enter a polynomial first.');
  const terms = compact.match(/[+-]?[^+-]+/g);
  if (!terms || terms.join('') !== compact) throw new Error('Use polynomial terms such as 3x^2 - 2x + 1.');
  const coefficients = new Map();
  for (const term of terms) {
    const match = term.match(/^([+-]?)(?:(\d*\.?\d+))?(?:x(?:\^(\d+))?)?$/i);
    if (!match || (!match[2] && !/x/i.test(term))) throw new Error(`Cannot read polynomial term: ${term}`);
    const hasVariable = /x/i.test(term);
    const coefficient = (match[1] === '-' ? -1 : 1) * (match[2] ? Number(match[2]) : hasVariable ? 1 : NaN);
    if (!Number.isFinite(coefficient)) throw new Error(`Cannot read polynomial term: ${term}`);
    const degree = hasVariable ? Number(match[3] || 1) : 0;
    coefficients.set(degree, (coefficients.get(degree) || 0) + coefficient);
  }
  const degree = Math.max(...coefficients.keys());
  const result = Array.from({ length: degree + 1 }, (_, index) => coefficients.get(degree - index) || 0);
  while (result.length > 1 && Math.abs(result[0]) < 1e-14) result.shift();
  return result;
}

function evaluatePolynomialComplex(coefficients, value) {
  return coefficients.reduce((result, coefficient) => complexMath.add(complexMath.multiply(result, value), { re: coefficient, im: 0 }), { re: 0, im: 0 });
}

function cubicRoots(coefficients) {
  const [leading, second, third, constant] = coefficients;
  const a = second / leading;
  const b = third / leading;
  const c = constant / leading;
  const p = b - a * a / 3;
  const q = 2 * a ** 3 / 27 - a * b / 3 + c;
  const discriminant = complexMath.add({ re: (q / 2) ** 2, im: 0 }, { re: (p / 3) ** 3, im: 0 });
  const squareRoot = complexMath.sqrt(discriminant);
  const firstCube = complexMath.cbrt(complexMath.add({ re: -q / 2, im: 0 }, squareRoot));
  let secondCube;
  if (complexMath.abs(firstCube) > 1e-12) secondCube = complexMath.divide({ re: -p / 3, im: 0 }, firstCube);
  else secondCube = complexMath.cbrt(complexMath.subtract({ re: -q / 2, im: 0 }, squareRoot));
  const omega = { re: -.5, im: Math.sqrt(3) / 2 };
  const omegaSquared = { re: -.5, im: -Math.sqrt(3) / 2 };
  const shift = { re: -a / 3, im: 0 };
  return [
    complexMath.add(complexMath.add(firstCube, secondCube), shift),
    complexMath.add(complexMath.add(complexMath.multiply(omega, firstCube), complexMath.multiply(omegaSquared, secondCube)), shift),
    complexMath.add(complexMath.add(complexMath.multiply(omegaSquared, firstCube), complexMath.multiply(omega, secondCube)), shift)
  ];
}

function durandKernerRoots(coefficients) {
  const degree = coefficients.length - 1;
  const monic = coefficients.map(value => value / coefficients[0]);
  const radius = 1 + Math.max(...monic.slice(1).map(Math.abs));
  let roots = Array.from({ length: degree }, (_, index) => {
    const angle = 2 * Math.PI * (index + .37) / degree;
    return { re: radius * Math.cos(angle), im: radius * Math.sin(angle) };
  });
  for (let iteration = 0; iteration < 600; iteration += 1) {
    let largestChange = 0;
    const nextRoots = roots.map((root, index) => {
      let denominator = { re: 1, im: 0 };
      roots.forEach((other, otherIndex) => {
        if (index !== otherIndex) denominator = complexMath.multiply(denominator, complexMath.subtract(root, other));
      });
      if (complexMath.abs(denominator) < 1e-24) denominator = complexMath.add(denominator, { re: 1e-12, im: 1e-12 });
      const correction = complexMath.divide(evaluatePolynomialComplex(monic, root), denominator);
      const updated = complexMath.subtract(root, correction);
      largestChange = Math.max(largestChange, complexMath.abs(correction));
      return updated;
    });
    roots = nextRoots;
    if (largestChange < 1e-12) break;
  }
  return roots;
}

function formatRoot(root) {
  const real = Math.abs(root.re) < 1e-9 ? 0 : root.re;
  const imaginary = Math.abs(root.im) < 1e-9 ? 0 : root.im;
  if (imaginary === 0) return math.format(real, { precision: 9 });
  const imagPart = Math.abs(imaginary) === 1 ? 'i' : `${math.format(Math.abs(imaginary), { precision: 9 })}i`;
  if (real === 0) return imaginary < 0 ? `−${imagPart}` : imagPart;
  return `${math.format(real, { precision: 9 })} ${imaginary < 0 ? '−' : '+'} ${imagPart}`;
}

function solvePolynomial() {
  const expression = $('#equation-input').value.trim();
  try {
    const coefficients = polynomialCoefficients(expression);
    const degree = coefficients.length - 1;
    if (degree === 0) throw new Error(Math.abs(coefficients[0]) < 1e-14 ? 'Every value is a root.' : 'A non-zero constant has no roots.');
    let roots;
    if (degree === 1) roots = [{ re: -coefficients[1] / coefficients[0], im: 0 }];
    else if (degree === 2) {
      const [a, b, c] = coefficients;
      const discriminant = b * b - 4 * a * c;
      const root = complexMath.sqrt({ re: discriminant, im: 0 });
      roots = [complexMath.scale(complexMath.add({ re: -b, im: 0 }, root), 1 / (2 * a)), complexMath.scale(complexMath.subtract({ re: -b, im: 0 }, root), 1 / (2 * a))];
    } else if (degree === 3) roots = cubicRoots(coefficients);
    else roots = durandKernerRoots(coefficients);
    roots.sort((left, right) => left.re - right.re || left.im - right.im);
    const result = roots.map((root, index) => `x${index + 1} = ${formatRoot(root)}`).join('  ·  ');
    showToolResult('equation-output', result, degree > 3 ? 'Roots approximated numerically with Durand–Kerner.' : 'Roots computed using closed-form formulas.');
    recordHistory(expression, result, 'Equations');
  } catch (error) {
    showToolResult('equation-output', error.message || 'Could not solve this polynomial.');
  }
}

function buildMatrixGrids() {
  const dimensions = [
    ['a', Number($('#matrix-rows').value), Number($('#matrix-columns').value)],
    ['b', Number($('#matrix-b-rows').value), Number($('#matrix-b-columns').value)]
  ];
  for (const [name, rows, columns] of dimensions) {
    if (!Number.isInteger(rows) || !Number.isInteger(columns) || rows < 1 || columns < 1 || rows * columns > 400) {
      showToolResult('matrix-output', 'Choose dimensions from 1 to 400 total cells per matrix.');
      return;
    }
    const grid = $(`#matrix-${name}`);
    grid.replaceChildren();
    grid.style.gridTemplateColumns = `repeat(${columns}, 53px)`;
    let wrap = grid.closest('.matrix-grid-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'matrix-grid-wrap';
      grid.before(wrap);
      wrap.append(grid);
    }
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const input = document.createElement('input');
        input.type = 'number';
        input.step = 'any';
        input.value = row === column ? '1' : '0';
        input.dataset.row = row;
        input.dataset.column = column;
        input.setAttribute('aria-label', `Matrix ${name.toUpperCase()} row ${row + 1} column ${column + 1}`);
        grid.append(input);
      }
    }
  }
}

function readMatrix(name) {
  const grid = $(`#matrix-${name}`);
  const inputs = $$('input', grid);
  const rows = name === 'a' ? Number($('#matrix-rows').value) : Number($('#matrix-b-rows').value);
  const columns = name === 'a' ? Number($('#matrix-columns').value) : Number($('#matrix-b-columns').value);
  const matrix = Array.from({ length: rows }, () => Array(columns).fill(0));
  inputs.forEach(input => {
    const value = Number(input.value);
    if (!Number.isFinite(value)) throw new Error('Enter a number in every matrix cell.');
    matrix[Number(input.dataset.row)][Number(input.dataset.column)] = value;
  });
  return matrix;
}

function populateMatrixGrid(name, matrix) {
  matrix.forEach((row, rowIndex) => row.forEach((value, columnIndex) => {
    const input = $(`#matrix-${name} input[data-row="${rowIndex}"][data-column="${columnIndex}"]`);
    if (input) input.value = value;
  }));
}

function transposeMatrix(matrix) {
  return matrix[0].map((_, column) => matrix.map(row => row[column]));
}

function determinantMatrix(matrix) {
  if (matrix.length !== matrix[0].length) throw new Error('Determinant requires a square matrix.');
  const work = matrix.map(row => [...row]);
  let determinant = 1;
  for (let column = 0; column < work.length; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < work.length; row += 1) if (Math.abs(work[row][column]) > Math.abs(work[pivot][column])) pivot = row;
    if (Math.abs(work[pivot][column]) < 1e-12) return 0;
    if (pivot !== column) { [work[pivot], work[column]] = [work[column], work[pivot]]; determinant *= -1; }
    const value = work[column][column];
    determinant *= value;
    for (let row = column + 1; row < work.length; row += 1) {
      const factor = work[row][column] / value;
      for (let index = column + 1; index < work.length; index += 1) work[row][index] -= factor * work[column][index];
    }
  }
  return determinant;
}

function inverseMatrix(matrix) {
  if (matrix.length !== matrix[0].length) throw new Error('Inverse requires a square matrix.');
  const size = matrix.length;
  const work = matrix.map((row, index) => [...row, ...Array.from({ length: size }, (_, column) => Number(index === column))]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) if (Math.abs(work[row][column]) > Math.abs(work[pivot][column])) pivot = row;
    if (Math.abs(work[pivot][column]) < 1e-12) throw new Error('This matrix is singular and has no inverse.');
    [work[pivot], work[column]] = [work[column], work[pivot]];
    const divisor = work[column][column];
    work[column] = work[column].map(value => value / divisor);
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = work[row][column];
      work[row] = work[row].map((value, index) => value - factor * work[column][index]);
    }
  }
  return work.map(row => row.slice(size));
}

function rankMatrix(matrix) {
  const work = matrix.map(row => [...row]);
  let rank = 0;
  for (let column = 0; column < work[0].length && rank < work.length; column += 1) {
    let pivot = rank;
    for (let row = rank + 1; row < work.length; row += 1) if (Math.abs(work[row][column]) > Math.abs(work[pivot][column])) pivot = row;
    if (Math.abs(work[pivot][column]) < 1e-10) continue;
    [work[pivot], work[rank]] = [work[rank], work[pivot]];
    const divisor = work[rank][column];
    for (let index = column; index < work[rank].length; index += 1) work[rank][index] /= divisor;
    for (let row = 0; row < work.length; row += 1) {
      if (row === rank) continue;
      const factor = work[row][column];
      for (let index = column; index < work[row].length; index += 1) work[row][index] -= factor * work[rank][index];
    }
    rank += 1;
  }
  return rank;
}

function renderMatrixResult(matrix) {
  const result = $('#matrix-output');
  result.querySelector('strong').textContent = `Matrix ${matrix.length} × ${matrix[0].length}`;
  const note = result.querySelector('.output-note');
  note.replaceChildren();
  const grid = document.createElement('div');
  grid.className = 'matrix-result-grid';
  grid.style.gridTemplateColumns = `repeat(${matrix[0].length}, minmax(48px, 1fr))`;
  matrix.forEach(row => row.forEach(value => {
    const cell = document.createElement('span');
    cell.textContent = math.format(value, { precision: 8 });
    grid.append(cell);
  }));
  note.append(grid);
}

function calculateMatrix() {
  const operation = $('#matrix-operation').value;
  try {
    const a = readMatrix('a');
    const b = ['add', 'subtract', 'multiply'].includes(operation) ? readMatrix('b') : null;
    let value;
    if (operation === 'add' || operation === 'subtract') {
      if (a.length !== b.length || a[0].length !== b[0].length) throw new Error('Addition and subtraction require matrices of the same shape.');
      value = a.map((row, i) => row.map((item, j) => operation === 'add' ? item + b[i][j] : item - b[i][j]));
    } else if (operation === 'multiply') {
      if (a[0].length !== b.length) throw new Error('For multiplication, columns in A must equal rows in B.');
      value = a.map(row => b[0].map((_, column) => row.reduce((sum, item, index) => sum + item * b[index][column], 0)));
    } else if (operation === 'transpose') value = transposeMatrix(a);
    else if (operation === 'determinant') value = determinantMatrix(a);
    else if (operation === 'inverse') value = inverseMatrix(a);
    else value = rankMatrix(a);
    const result = Array.isArray(value) ? JSON.stringify(value) : math.format(value, { precision: 10 });
    if (Array.isArray(value)) renderMatrixResult(value);
    else showToolResult('matrix-output', result);
    const payload = { a, b };
    recordHistory(`matrix:${operation}:${JSON.stringify(payload)}`, result, 'Matrix');
  } catch (error) {
    showToolResult('matrix-output', error.message || 'Could not calculate this matrix operation.');
  }
}

$('#complex-submit').addEventListener('click', calculateComplex);
$('#vector-submit').addEventListener('click', calculateVector);
$('#vector-dimension').addEventListener('change', () => {
  const dimension = Number($('#vector-dimension').value);
  $('#vector-a').value = dimension === 2 ? '2, 3' : '2, 3, 1';
  $('#vector-b').value = dimension === 2 ? '4, 1' : '4, 1, 2';
});
function saveBaseConversion() {
  const value = updateBaseOutputs();
  if (value === null) return false;
  const base = Number($('#base-from').value);
  const result = `bin ${value.toString(2)} · oct ${value.toString(8)} · dec ${value.toString(10)} · hex ${value.toString(16).toUpperCase()}`;
  const expression = `base ${base}: ${$('#base-input').value.trim()}`;
  const key = `${expression}=${result}`;
  if (key !== lastSavedBaseConversion) {
    lastSavedBaseConversion = key;
    recordHistory(expression, result, 'Number Base');
  }
  return true;
}
function scheduleBaseHistory() {
  clearTimeout(baseHistoryTimer);
  baseHistoryTimer = setTimeout(saveBaseConversion, 700);
}
$('#base-input').addEventListener('input', () => { updateBaseOutputs(); scheduleBaseHistory(); });
$('#base-from').addEventListener('change', () => { updateBaseOutputs(); scheduleBaseHistory(); });
$('#base-save').addEventListener('click', () => { clearTimeout(baseHistoryTimer); saveBaseConversion(); });
$('#equation-submit').addEventListener('click', solvePolynomial);
$('#equation-input').addEventListener('keydown', event => { if (event.key === 'Enter') solvePolynomial(); });
$('#matrix-build').addEventListener('click', buildMatrixGrids);
['#matrix-rows', '#matrix-columns', '#matrix-b-rows', '#matrix-b-columns'].forEach(selector => $(selector).addEventListener('change', buildMatrixGrids));
$('#matrix-submit').addEventListener('click', calculateMatrix);
buildMatrixGrids();
updateBaseOutputs();