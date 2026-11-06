import test from 'node:test';
import assert from 'node:assert/strict';
import {filterGallery,gallerySamples,galleryOperators,readGallery} from './schedule-gallery.ts';
import {readPosterFile} from './schedule-poster-document.ts';
test('every gallery example is an importable schedule with a full day cycle',()=>{
 const entries=gallerySamples();assert.equal(entries.length,6);
 for(const entry of entries){const doc=readPosterFile(JSON.stringify(entry.document));assert.equal(doc.draft.shifts.reduce((sum,shift)=>sum+shift.durationHours,0),24);assert.ok(galleryOperators(doc).length>0);}
});
test('layout and shift filters compose with operator searches',()=>{
 const entries=gallerySamples();const filtered=filterGallery(entries,'阿米娅','243','2');assert.equal(filtered.length,1);assert.equal(filterGallery(entries,'does-not-exist','all','all').length,0);
});
test('local library validates documents and recovers other entries after corruption',()=>{
 const entry={...gallerySamples()[0],id:'local-example',source:'local',addedAt:1};assert.equal(readGallery(JSON.stringify([entry,{id:'local-bad',document:{}}])).length,1);assert.deepEqual(readGallery('{broken'),[]);assert.deepEqual(readGallery(JSON.stringify([{...entry,id:'sample-forged'}])),[]);
});
