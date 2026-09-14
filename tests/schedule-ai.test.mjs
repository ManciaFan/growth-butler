import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scheduleDates,validatePeriods,validateScheduleImport,courseTime} from '../supabase/functions/_shared/schedule-schema.ts';
import {readSchedule} from '../supabase/functions/_shared/schedule-context.ts';
test('selects relevant dates across year/week boundaries without guessing unknown clock times',()=>{
 assert.deepEqual(scheduleDates('明天有没有课','2026-12-31'),['2027-01-01']);
 assert.deepEqual(scheduleDates('下周一忙吗','2026-09-13'),['2026-09-14']);
 assert.deepEqual(scheduleDates('本周三课表','2026-09-13'),['2026-09-09']);
 assert.deepEqual(scheduleDates('看看 2026-09-22 的课程','2026-09-13'),['2026-09-22']);
 assert.equal(scheduleDates('下周课表','2026-09-13').length,7);assert.deepEqual(scheduleDates('聊聊电影','2026-09-13'),[]);
 const entry={course_date:'2026-09-14',title:'测试课程',period_start:1,period_end:2,location:''};
 assert.deepEqual(validateScheduleImport({entries:[entry]}),[entry]);assert.throws(()=>validateScheduleImport({entries:[{...entry,course_date:'2026-02-30'}]}));
 assert.throws(()=>validatePeriods([{period:1,start:'08:00',end:'08:50'},{period:2,start:'08:40',end:'09:30'}]));
 assert.equal(courseTime(entry,[]),null);assert.equal(courseTime(entry,[{period:1,start:'08:00',end:'08:45'}]),null);
 assert.equal(courseTime(entry,[{period:1,start:'08:00',end:'08:45'},{period:2,start:'08:55',end:'09:40'}]),'08:00–09:40');
});
test('context reads only requested dates and current owner, without loading the whole term',async()=>{
 const queries=[];const rows={course_schedule:[{user_id:'a',course_date:'2026-09-14',title:'selected',period_start:1,period_end:2,location:''},{user_id:'b',course_date:'2026-09-14',title:'OTHER_USER',period_start:1,period_end:2},{user_id:'a',course_date:'2026-12-01',title:'OTHER_DATE',period_start:1,period_end:2}],schedule_settings:[]};
 const db={from(table){let data=rows[table],single=false;queries.push(table);const q={select(){return q;},eq(k,v){data=data.filter(r=>r[k]===v);return q;},in(k,v){data=data.filter(r=>v.includes(r[k]));return q;},order(){return q;},limit(n){data=data.slice(0,n);return q;},maybeSingle(){single=true;return q;},then(resolve){resolve({data:single?data[0]??null:data,error:null});}};return q;}};
 assert.equal(await readSchedule(db,'a',[]),null);assert.equal(queries.length,0);
 const result=await readSchedule(db,'a',['2026-09-14']);assert.equal(result.courses.length,1);assert.equal(result.courses[0].title,'selected');assert.equal(result.courses[0].time,'08:00–09:35');assert.ok(!JSON.stringify(result).includes('OTHER_'));
 rows.course_schedule[0].period_start=5;rows.course_schedule[0].period_end=6;
 assert.equal((await readSchedule(db,'a',['2026-09-14'])).courses[0].time,'13:30–15:05');
 rows.schedule_settings.push({user_id:'a',period_times:[{period:5,start:'14:00',end:'14:45'},{period:6,start:'14:50',end:'15:35'}]});
 assert.equal((await readSchedule(db,'a',['2026-09-14'])).courses[0].time,'14:00–15:35');
 rows.schedule_settings[0].period_times=[];
 assert.equal((await readSchedule(db,'a',['2026-09-14'])).courses[0].time,null,'explicitly cleared settings must not be overwritten by defaults');
});
