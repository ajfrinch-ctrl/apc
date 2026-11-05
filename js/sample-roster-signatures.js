/* Fingerprints of the sample roster that ships in js/admin-data.js as a design
   fixture. They live in their own tiny module because the student offline shell
   must never download that whole fixture file, while the roster still has to
   recognise a sample row that once reached a real database.

   A row is matched only when identifier, name AND mobile agree; tests keep this
   list in step with admin-data.js. */
export const SHIPPED_SAMPLE_ROSTER = Object.freeze([
  Object.freeze({ id: 'AP-1024', name: 'রাইসা ইসলাম', mobile: '01700000000' }),
  Object.freeze({ id: '260810021', name: 'তহমিদ হাসান', mobile: '01811223344' }),
  Object.freeze({ id: '260712005', name: 'সাদিয়া আফরিন', mobile: '01677889900' }),
  Object.freeze({ id: '260909032', name: 'মেহেদী হাসান', mobile: '01933445566' }),
  Object.freeze({ id: '260908018', name: 'আরিফ চৌধুরী', mobile: '01311223344' }),
  Object.freeze({ id: '260810019', name: 'ফারহান রহমান', mobile: '01422334455' }),
  Object.freeze({ id: '260716011', name: 'সুমাইয়া খাতুন', mobile: '01766778899' }),
  Object.freeze({ id: '260613004', name: 'ইমরান হোসেন', mobile: '01555667788' })
]);
