/* Minimal Realtime Database rules SIMULATOR for unit tests.

   It is NOT the Firebase rules engine and proves nothing about production. It
   exists so the proposed access matrix (database.rules.v2.draft.json) can be
   regression-tested in CI without Java or the database emulator. The emulator
   suite in functions/test/rtdb-rules.test.js is the authoritative check.

   Implemented semantics (the subset the draft uses):
     • .read/.write cascade: the first ancestor-or-self rule that is true grants;
       a deeper rule can never revoke it, and a parent read is NOT granted by
       child rules (rules are not filters).
     • .validate is evaluated (non-cascading) on every rule node whose new value
       is non-null along the written path and inside the written value.
     • wildcard $variables, auth (null or { uid, token }), root, data, newData,
       now; snapshot .val() .child() .exists() .hasChild() .hasChildren()
       .isString() .isNumber() .isBoolean().
     • a missing claim reads as null (not undefined), like the real engine.
     • an evaluation error (e.g. child(null)) counts as false. */

const clone = value => value === undefined ? null : JSON.parse(JSON.stringify(value));
const segments = path => String(path).split('/').filter(Boolean);

function getAt(tree, parts) {
  let node = tree;
  for (const part of parts) {
    if (node === null || typeof node !== 'object' || !Object.hasOwn(node, part)) return null;
    node = node[part];
  }
  return node === undefined ? null : node;
}

function prune(value) {
  if (value === null || typeof value !== 'object') return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    const next = prune(child);
    if (next !== null) out[key] = next;
  }
  return Object.keys(out).length ? out : null;
}

function setAt(tree, parts, value) {
  if (!parts.length) return prune(clone(value));
  const base = tree && typeof tree === 'object' ? { ...tree } : {};
  base[parts[0]] = setAt(base[parts[0]] ?? null, parts.slice(1), value);
  return prune(base);
}

class Snap {
  constructor(tree, parts) { this.tree = tree; this.parts = parts; }
  val() { return clone(getAt(this.tree, this.parts)); }
  child(path) {
    if (typeof path !== 'string' || !path) throw new Error('child() needs a non-empty string');
    return new Snap(this.tree, [...this.parts, ...segments(path)]);
  }
  exists() { return this.val() !== null; }
  hasChild(path) { return this.child(path).exists(); }
  hasChildren(list) {
    const value = this.val();
    if (!value || typeof value !== 'object') return false;
    return list ? list.every(key => this.hasChild(key)) : Object.keys(value).length > 0;
  }
  numChildren() {
    const value = this.val();
    return value && typeof value === 'object' ? Object.keys(value).length : 0;
  }
  isString() { return typeof this.val() === 'string'; }
  isNumber() { return typeof this.val() === 'number'; }
  isBoolean() { return typeof this.val() === 'boolean'; }
}

const nullish = target => new Proxy(target, {
  get(object, key) {
    if (typeof key === 'symbol') return object[key];
    const value = object[key];
    if (value === undefined) return null;
    return value && typeof value === 'object' ? nullish(value) : value;
  }
});

function evaluate(expression, scope) {
  if (typeof expression === 'boolean') return expression;
  const names = Object.keys(scope);
  try {
    // eslint-disable-next-line no-new-func
    return new Function(...names, `"use strict"; return (${expression});`)(...names.map(name => scope[name])) === true;
  } catch {
    return false;
  }
}

/** Rule nodes along `parts`, with the wildcard bindings in force at each. */
function ruleChain(rules, parts) {
  const chain = [{ node: rules, depth: 0, vars: {} }];
  let node = rules;
  let vars = {};
  for (let index = 0; index < parts.length && node; index += 1) {
    const part = parts[index];
    let next = node[part];
    if (!next || typeof next !== 'object') {
      const wildcard = Object.keys(node).find(key => key.startsWith('$'));
      next = wildcard ? node[wildcard] : null;
      if (wildcard) vars = { ...vars, [wildcard]: part };
    }
    if (!next) break;
    node = next;
    chain.push({ node, depth: index + 1, vars });
  }
  return chain;
}

export function createSimulator(policy, { now = Date.now() } = {}) {
  const rules = policy.rules;
  const authOf = user => user ? nullish({ uid: user.uid, token: { firebase: { sign_in_provider: 'password' }, ...user.token } }) : null;

  function scopeFor(entry, parts, auth, oldRoot, newRoot) {
    const here = parts.slice(0, entry.depth);
    return {
      auth, now,
      root: new Snap(oldRoot, []),
      data: new Snap(oldRoot, here),
      newData: new Snap(newRoot, here),
      ...entry.vars
    };
  }

  function canRead(user, path, state = null) {
    const parts = segments(path);
    const auth = authOf(user);
    return ruleChain(rules, parts).some(entry =>
      Object.hasOwn(entry.node, '.read') && evaluate(entry.node['.read'], scopeFor(entry, parts, auth, state, state)));
  }

  function validateTree(node, parts, depth, vars, auth, oldRoot, newRoot) {
    const here = parts.slice(0, depth);
    if (getAt(newRoot, here) === null) return true;
    if (Object.hasOwn(node, '.validate')) {
      const scope = { auth, now, root: new Snap(oldRoot, []), data: new Snap(oldRoot, here), newData: new Snap(newRoot, here), ...vars };
      if (!evaluate(node['.validate'], scope)) return false;
    }
    const value = getAt(newRoot, here);
    if (!value || typeof value !== 'object') return true;
    const wildcard = Object.keys(node).find(key => key.startsWith('$'));
    for (const key of Object.keys(value)) {
      const child = node[key] && typeof node[key] === 'object' ? node[key] : wildcard ? node[wildcard] : null;
      if (!child) continue;
      const childVars = node[key] ? vars : { ...vars, [wildcard]: key };
      if (!validateTree(child, [...here, key], depth + 1, childVars, auth, oldRoot, newRoot)) return false;
    }
    return true;
  }

  function canWrite(user, path, value, state = null) {
    const parts = segments(path);
    const auth = authOf(user);
    const newRoot = setAt(state, parts, value);
    const chain = ruleChain(rules, parts);
    const granted = chain.some(entry =>
      Object.hasOwn(entry.node, '.write') && evaluate(entry.node['.write'], scopeFor(entry, parts, auth, state, newRoot)));
    if (!granted) return false;
    // Ancestors (and the target) whose new value is non-null must validate…
    for (const entry of chain.slice(0, -1)) {
      if (!Object.hasOwn(entry.node, '.validate')) continue;
      if (getAt(newRoot, parts.slice(0, entry.depth)) === null) continue;
      if (!evaluate(entry.node['.validate'], scopeFor(entry, parts, auth, state, newRoot))) return false;
    }
    // …and so must the target and everything written beneath it.
    const last = chain[chain.length - 1];
    if (last.depth < parts.length) return true; // written below the rule tree
    return validateTree(last.node, parts, last.depth, last.vars, auth, state, newRoot);
  }

  return { canRead, canWrite };
}
