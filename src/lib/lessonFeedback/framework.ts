/**
 * The school's teacher-talk framework. Each standard says what the feedback
 * model should listen for and how much of it an audio recording can show:
 *
 *   transcript — judged from what is said
 *   timing     — mainly measured from speech timing (see metrics.ts)
 *   partial    — only partly audible (e.g. what is written on the board)
 */

export type Audibility = 'transcript' | 'timing' | 'partial';

export interface FrameworkStandard {
  id: string;
  title: string;
  lookFor: string;
  audibility: Audibility;
}

export const TEACHER_TALK_FRAMEWORK: readonly FrameworkStandard[] = [
  {
    id: 'explanations',
    title: 'Concise, accurate explanations',
    lookFor:
      'Explanations are short, precise and correct; no rambling, tangents or subject errors.',
    audibility: 'transcript',
  },
  {
    id: 'modelling',
    title: 'Clear models with steps',
    lookFor:
      'Worked examples are narrated step by step ("first…", "next…", "now I check…") with the thinking made explicit. Board work itself is not audible.',
    audibility: 'partial',
  },
  {
    id: 'cold_call',
    title: 'Frequent cold-call questioning',
    lookFor:
      'Many questions, directed at named students rather than volunteers ("hands down", "Jamal, what…"). Count and quote them.',
    audibility: 'transcript',
  },
  {
    id: 'participation',
    title: 'High class participation ratio',
    lookFor:
      'Students speak often and many different students contribute; the teacher does not dominate the airtime. Use the measured talk ratio and student turn counts.',
    audibility: 'timing',
  },
  {
    id: 'stretch',
    title: 'Stretch questioning',
    lookFor:
      'Follow-up questions that push thinking: "why?", "how do you know?", "what if…?", "can you improve that answer?", building on a student response.',
    audibility: 'transcript',
  },
  {
    id: 'silent_practice',
    title: 'Silent classrooms for practice',
    lookFor:
      'Independent practice happens in silence, set up explicitly ("in silence, you have…"). Use the measured silent periods; chatter or repeated teacher talk during practice counts against.',
    audibility: 'timing',
  },
  {
    id: 'behaviour_standards',
    title: 'Enforcement of behaviour standards',
    lookFor:
      'Expectations stated clearly and followed through consistently and calmly; consequences applied when stated.',
    audibility: 'transcript',
  },
  {
    id: 'swift_correction',
    title: 'Swift correction of poor standards',
    lookFor:
      'Low-level disruption or poor work standards corrected quickly, briefly and without derailing the lesson.',
    audibility: 'transcript',
  },
  {
    id: 'rapid_praise',
    title: 'Rapid, precise praise',
    lookFor:
      'Students doing the right thing are acknowledged quickly and specifically ("thank you Priya for starting straight away").',
    audibility: 'transcript',
  },
  {
    id: 'checking_understanding',
    title: 'Checking for understanding throughout',
    lookFor:
      'Frequent checks across the lesson (mini-whiteboards, show-me, targeted questions) and adapting on what is found. Not just "does everyone understand?".',
    audibility: 'transcript',
  },
  {
    id: 'time_frames',
    title: 'Clear time frames for tasks',
    lookFor:
      'Every task is given an explicit time limit ("you have three minutes"), with countdowns or time checks.',
    audibility: 'transcript',
  },
  {
    id: 'turn_and_talk',
    title: 'Structured turn and talk',
    lookFor:
      'Turn and talk has a clear prompt, partner roles/order, a time limit and a clean call-back, used consistently.',
    audibility: 'transcript',
  },
  {
    id: 'attention_signal',
    title: 'SLANT or equivalent attention cue',
    lookFor:
      'A consistent routine to gain full attention (SLANT, "tracking me", countdown to silence) that is used and waited on until met.',
    audibility: 'transcript',
  },
] as const;

export const FRAMEWORK_IDS = TEACHER_TALK_FRAMEWORK.map((s) => s.id);
