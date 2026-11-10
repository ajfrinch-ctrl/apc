# -*- coding: utf-8 -*-
"""Narration Master Lecture Sheet — sections 1–4 (definitions, person, tense)."""

SHORTCUTS = {
    't': 'box', 'variant': 'green',
    'title': 'ঝটপট রিভিশন — সহজে মনে রাখার শর্টকাট  (Memory Shortcuts)',
    'lines': [
        ('b', 'মূল ৫টি ধাপ: Reporting Verb পরিবর্তন → Conjunction বসানো → Person পরিবর্তন (123/SON) → Tense পরিবর্তন → Nearness Words পরিবর্তন।'),
        ('b', 'Person সূত্র (123/SON): First Person → Subject অনুযায়ী, Second Person → Object অনুযায়ী, Third Person → অপরিবর্তিত।'),
        ('b', 'Sentence Conjunction: Assertive (that), Interrogative (if / wh-word), Imperative (to / not to), Optative (that), Exclamatory (that)।'),
        ('b', 'Tense সূত্র: Reporting Verb Present/Future হলে Tense বদলায় না; Past হলে Reported Speech একধাপ পেছনে যায়।'),
    ],
}

SECTION_1 = [
    {'t': 'h2', 'n': '১', 'bn': 'ন্যারেশনের মৌলিক সংজ্ঞা', 'en': '(Basic Definitions)'},
    {'t': 'p', 'x': 'বক্তার বক্তব্যকে অন্যের কাছে প্রকাশ করার মাধ্যম বা প্রক্রিয়াকে **Narration** বা উক্তি বলে। এটি প্রধানত দুই প্রকার —'},
    {'t': 'bullets', 'items': [
        '**Direct Narration (প্রত্যক্ষ উক্তি):** বক্তার আসল কথাটি ইনভার্টেড কমা (" ") ভেতরে কোনো রূপান্তর ছাড়াই হুবহু প্রকাশ করা হয়।',
        '**Indirect Narration (পরোক্ষ উক্তি):** বক্তার কথাটি নিজের ভাষায় বা রূপান্তর করে অন্যের কাছে প্রকাশ করা হয়।',
    ]},
    {'t': 'p', 'x': 'Direct Narration-এর দুটি প্রধান অংশ থাকে। উদাহরণ: **He said to me, "I am writing a letter."**'},
    {'t': 'bullets', 'items': [
        '**Reporting Verb:** ইনভার্টেড কমার বাইরের অংশ (এখানে said to)।',
        '**Reported Speech:** ইনভার্টেড কমার ভেতরের অংশ (এখানে "I am writing a letter.")।',
    ]},
    {'t': 'box', 'variant': 'blue', 'title': 'মনে রাখার সহজ নিয়ম',
     'lines': [
         ('p', 'Direct থেকে Indirect করার সময় যে চারটি জিনিস বদলাতে হয়: **(১)** Reporting Verb, **(২)** Conjunction, **(৩)** Pronoun (Person), **(৪)** Tense ও Nearness Words।'),
     ]},
]

SECTION_2 = [
    {'t': 'h2', 'n': '২', 'bn': 'পার্সনের পরিবর্তন', 'en': '(Change of Person: 123 / SON)'},
    {'t': 'p', 'x': 'Reported Speech-এর Person পরিবর্তনের জন্য সর্বজনীন সূত্র হলো **123 / SON** —'},
    {'t': 'table',
     'head': ['সূত্র', 'Reported Speech-এর Person', 'কার অনুসারী হবে (Reporting Verb)'],
     'widths': [0.13, 0.44, 0.43],
     'rows': [
         ['1 = S', 'First Person (I, we, my, our, me, us)', 'Reporting Verb-এর **Subject** অনুযায়ী'],
         ['2 = O', 'Second Person (you, your, yours)', 'Reporting Verb-এর **Object** অনুযায়ী'],
         ['3 = N', 'Third Person (he, she, it, they, any name)', '**No Change** (কোনো পরিবর্তন হবে না)'],
     ]},
    {'t': 'h3', 'x': 'উদাহরণ ও ব্যাখ্যা'},
    {'t': 'examples', 'items': [
        {'d': 'He said to me, "I love my country."', 'i': 'He told me that he loved **his** country.',
         'why': 'First Person (I, my) Reporting Verb-এর Subject (He) অনুযায়ী পরিবর্তিত হয়ে he ও his হয়েছে।'},
        {'d': 'He said to me, "You have lost your book."', 'i': 'He told me that I had lost **my** book.',
         'why': 'Second Person (You, your) Reporting Verb-এর Object (me) অনুযায়ী পরিবর্তিত হয়ে I ও my হয়েছে।'},
        {'d': 'She said, "Rahim is doing his work."', 'i': 'She said that Rahim **was** doing his work.',
         'why': 'Third Person (Rahim, his) অপরিবর্তিত থেকেছে; শুধু Tense পরিবর্তিত হয়েছে।'},
    ]},
    {'t': 'practice', 'title': 'অনুশীলন — পার্সন পরিবর্তন (Practice Exercises)',
     'items': [
         'He said, "I am doing my work."',
         'She said to me, "You are my best friend."',
         'I said to him, "You have stolen my pen."',
         'They said to us, "We will support you."',
         'Rahim said, "She knows the answer."',
         'The boy said to his father, "I need your help."',
         'You said to her, "You look very tired."',
         'Mina said to her brother, "I have found your watch."',
         'The teacher said to the students, "You should read your books."',
         'Kamal said to me, "They are playing in our playground."',
     ]},
    {'t': 'answers', 'title': 'উত্তরমালা — পার্সন পরিবর্তন (Answers)',
     'items': [
         'He said that he was doing his work.',
         'She told me that I was her best friend.',
         'I told him that he had stolen my pen.',
         'They told us that they would support us.',
         'Rahim said that she knew the answer.',
         'The boy told his father that he needed his help.',
         'You told her that she looked very tired.',
         'Mina told her brother that she had found his watch.',
         'The teacher told the students that they should read their books.',
         'Kamal told me that they were playing in our playground.',
     ]},
]

SECTION_3_HEAD = [
    {'t': 'h2', 'n': '৩', 'bn': 'টেন্স পরিবর্তনের নিয়ম', 'en': '(Change of Tense)'},
    {'t': 'box', 'variant': 'amber', 'title': 'মূল নিয়ম',
     'lines': [
         ('b', 'Reporting Verb যদি **Present Tense** (say / says) বা **Future Tense** (will say) হয়, তবে Reported Speech-এর Tense-এর কোনো পরিবর্তন হয় না।'),
         ('b', 'Reporting Verb যদি **Past Tense** হয়, তবে Reported Speech-এর Tense পরিবর্তিত হয়ে corresponding Past Tense হয়।'),
         ('b', 'Reported Speech-এ **চিরন্তন সত্য** (Universal Truth) বোঝালে Tense সর্বদা অপরিবর্তিত থাকে।'),
     ]},
    {'t': 'table', 'head': ['Direct Speech-এর Tense', 'Indirect Speech-এ রূপ', 'সহজ সূত্র'],
     'widths': [0.41, 0.37, 0.22],
     'rows': [
         ['Present Indefinite (V1)', 'Past Indefinite (V2)', 'eat → ate'],
         ['Present Continuous (am/is/are + ing)', 'Past Continuous (was/were + ing)', 'is doing → was doing'],
         ['Present Perfect (have/has + V3)', 'Past Perfect (had + V3)', 'has done → had done'],
         ['Present Perfect Continuous (have/has been + ing)', 'Past Perfect Continuous (had been + ing)', 'has been doing → had been doing'],
         ['Past Indefinite (V2)', 'Past Perfect (had + V3)', 'went → had gone'],
         ['Past Continuous (was/were + ing)', 'Past Perfect Continuous (had been + ing)', 'was doing → had been doing'],
         ['Past Perfect (had + V3)', 'অপরিবর্তিত', 'had done → had done'],
         ['Past Perfect Continuous (had been + ing)', 'অপরিবর্তিত', 'had been doing'],
         ['Future Indefinite (will / shall)', 'would', 'will do → would do'],
         ['Future Continuous (will be + ing)', 'would be + ing', 'will be doing → would be doing'],
         ['Future Perfect (will have + V3)', 'would have + V3', 'will have done → would have done'],
         ['can / may / must', 'could / might / had to', 'can → could'],
     ]},
]


def _tense_group(num, title, rule, items):
    return [
        {'t': 'h3', 'x': f'{num}  {title}'},
        {'t': 'rule', 'label': 'নিয়ম:', 'x': rule},
        {'t': 'examples', 'items': items},
    ]


TENSE_GROUPS = []
TENSE_GROUPS += _tense_group(
    '৩.১', 'Present Indefinite → Past Indefinite',
    'Reported Speech-এ Present Indefinite (V1) থাকলে তা Indirect বাক্যে Past Indefinite (V2) হয়।',
    [
        {'d': 'He said, "I eat rice."', 'i': 'He said that he **ate** rice.'},
        {'d': 'She said to me, "I like coffee."', 'i': 'She told me that she **liked** coffee.'},
        {'d': 'Kamal said, "Rina sings a song."', 'i': 'Kamal said that Rina **sang** a song.'},
        {'d': 'They said, "We live in Dhaka."', 'i': 'They said that they **lived** in Dhaka.'},
        {'d': 'The boy said to me, "You know the answer."', 'i': 'The boy told me that I **knew** the answer.'},
        {'d': 'Father said, "Time flies fast."', 'i': 'Father said that time **flew** fast.'},
        {'d': 'Rina said to him, "I want your pen."', 'i': 'Rina told him that she **wanted** his pen.'},
        {'d': 'He said, "My brother works hard."', 'i': 'He said that his brother **worked** hard.'},
        {'d': 'She said to us, "You make a noise."', 'i': 'She told us that we **made** a noise.'},
        {'d': 'The teacher said, "Students write essays."', 'i': 'The teacher said that students **wrote** essays.'},
    ])
TENSE_GROUPS += _tense_group(
    '৩.২', 'Present Continuous → Past Continuous',
    'am / is / are + verb+ing পরিবর্তিত হয়ে was / were + verb+ing হয়।',
    [
        {'d': 'She said, "I am reading a book."', 'i': 'She said that she **was reading** a book.'},
        {'d': 'He said to me, "You are doing well."', 'i': 'He told me that I **was doing** well.'},
        {'d': 'They said, "We are playing cricket."', 'i': 'They said that they **were playing** cricket.'},
        {'d': 'Rahim said, "The baby is crying."', 'i': 'Rahim said that the baby **was crying**.'},
        {'d': 'Mother said to me, "I am cooking food."', 'i': 'Mother told me that she **was cooking** food.'},
        {'d': 'The man said, "It is raining heavily."', 'i': 'The man said that it **was raining** heavily.'},
        {'d': 'She said to him, "You are wasting your time."', 'i': 'She told him that he **was wasting** his time.'},
        {'d': 'The students said, "We are listening to the lecture."', 'i': 'The students said that they **were listening** to the lecture.'},
        {'d': 'Kamal said to Rina, "I am drawing a picture."', 'i': 'Kamal told Rina that he **was drawing** a picture.'},
        {'d': 'The girl said, "Birds are flying in the sky."', 'i': 'The girl said that birds **were flying** in the sky.'},
    ])
TENSE_GROUPS += _tense_group(
    '৩.৩', 'Present Perfect → Past Perfect',
    'have / has + V3 পরিবর্তিত হয়ে had + V3 হয়।',
    [
        {'d': 'Rahim said, "I have done the work."', 'i': 'Rahim said that he **had done** the work.'},
        {'d': 'She said to me, "I have bought a car."', 'i': 'She told me that she **had bought** a car.'},
        {'d': 'The boy said, "He has lost his bag."', 'i': 'The boy said that he **had lost** his bag.'},
        {'d': 'They said to us, "We have won the match."', 'i': 'They told us that they **had won** the match.'},
        {'d': 'Mina said, "Mother has prepared tea."', 'i': 'Mina said that mother **had prepared** tea.'},
        {'d': 'He said to her, "You have broken the glass."', 'i': 'He told her that she **had broken** the glass.'},
        {'d': 'The teacher said, "All students have submitted homework."', 'i': 'The teacher said that all students **had submitted** homework.'},
        {'d': 'I said to him, "I have received your letter."', 'i': 'I told him that I **had received** his letter.'},
        {'d': 'Kamal said, "The train has left the station."', 'i': 'Kamal said that the train **had left** the station.'},
        {'d': 'She said to me, "You have helped me a lot."', 'i': 'She told me that I **had helped** her a lot.'},
    ])
TENSE_GROUPS += _tense_group(
    '৩.৪', 'Present Perfect Continuous → Past Perfect Continuous',
    'have / has been + verb+ing পরিবর্তিত হয়ে had been + verb+ing হয়।',
    [
        {'d': 'He said, "I have been working for two hours."', 'i': 'He said that he **had been working** for two hours.'},
        {'d': 'She said to me, "It has been raining since morning."', 'i': 'She told me that it **had been raining** since morning.'},
        {'d': 'They said, "We have been living here for five years."', 'i': 'They said that they **had been living there** for five years.',
         'why': 'Tense-এর সঙ্গে সঙ্গে here → there হয়েছে।'},
        {'d': 'Kamal said, "Rina has been reading a novel."', 'i': 'Kamal said that Rina **had been reading** a novel.'},
        {'d': 'The man said to me, "You have been waiting long."', 'i': 'The man told me that I **had been waiting** long.'},
        {'d': 'Mother said, "The baby has been sleeping since noon."', 'i': 'Mother said that the baby **had been sleeping** since noon.'},
        {'d': 'Father said to his son, "You have been wasting time."', 'i': 'Father told his son that he **had been wasting** time.'},
        {'d': 'The gardener said, "I have been watering plants."', 'i': 'The gardener said that he **had been watering** plants.'},
        {'d': 'She said to her friend, "We have been studying together."', 'i': 'She told her friend that they **had been studying** together.'},
        {'d': 'He said, "He has been suffering from fever."', 'i': 'He said that he **had been suffering** from fever.'},
    ])
TENSE_GROUPS += _tense_group(
    '৩.৫', 'Past Indefinite → Past Perfect',
    'Past Indefinite (V2) থাকলে তা পরিবর্তিত হয়ে Past Perfect (had + V3) হয়।',
    [
        {'d': 'Kamal said, "I went to school."', 'i': 'Kamal said that he **had gone** to school.'},
        {'d': 'She said to me, "I bought a new book."', 'i': 'She told me that she **had bought** a new book.'},
        {'d': 'The boy said, "I lost my pen."', 'i': 'The boy said that he **had lost** his pen.'},
        {'d': 'They said to us, "We played football yesterday."', 'i': 'They told us that they **had played** football **the previous day**.'},
        {'d': 'Rahim said, "Rina wrote a nice poem."', 'i': 'Rahim said that Rina **had written** a nice poem.'},
        {'d': 'He said to her, "You helped my brother."', 'i': 'He told her that she **had helped** his brother.'},
        {'d': 'Mother said, "The milk spilled."', 'i': 'Mother said that the milk **had spilled**.'},
        {'d': 'The policeman said, "The thief ran away."', 'i': 'The policeman said that the thief **had run** away.'},
        {'d': 'She said to me, "You gave me a gift."', 'i': 'She told me that I **had given** her a gift.'},
        {'d': 'Father said, "I finished the work early."', 'i': 'Father said that he **had finished** the work early.'},
    ])
TENSE_GROUPS += _tense_group(
    '৩.৬', 'Past Continuous → Past Perfect Continuous',
    'was / were + verb+ing পরিবর্তিত হয়ে had been + verb+ing হয়।',
    [
        {'d': 'Mina said, "I was eating rice."', 'i': 'Mina said that she **had been eating** rice.'},
        {'d': 'He said to me, "You were sleeping then."', 'i': 'He told me that I **had been sleeping** then.'},
        {'d': 'They said, "We were watching TV."', 'i': 'They said that they **had been watching** TV.'},
        {'d': 'The boy said, "The dog was barking."', 'i': 'The boy said that the dog **had been barking**.'},
        {'d': 'She said to him, "I was waiting for you."', 'i': 'She told him that she **had been waiting** for him.'},
        {'d': 'Father said, "It was blowing a gale."', 'i': 'Father said that it **had been blowing** a gale.'},
        {'d': 'The students said, "We were making a noise."', 'i': 'The students said that they **had been making** a noise.'},
        {'d': 'Rina said to me, "You were singing a song."', 'i': 'Rina told me that I **had been singing** a song.'},
        {'d': 'He said, "She was drawing a map."', 'i': 'He said that she **had been drawing** a map.'},
        {'d': 'Mother said, "The maid was cleaning the floor."', 'i': 'Mother said that the maid **had been cleaning** the floor.'},
    ])
TENSE_GROUPS += _tense_group(
    '৩.৭', 'Past Perfect ও Past Perfect Continuous (অপরিবর্তিত থাকে)',
    'had + V3 এবং had been + verb+ing-এর কোনো রূপান্তর হয় না।',
    [
        {'d': 'The boy said, "I had finished the work."', 'i': 'The boy said that he **had finished** the work.'},
        {'d': 'She said to me, "I had reached before sunset."', 'i': 'She told me that she **had reached** before sunset.'},
        {'d': 'Rahim said, "They had left the village."', 'i': 'Rahim said that they **had left** the village.'},
        {'d': 'Kamal said to Rina, "I had already seen the film."', 'i': 'Kamal told Rina that he **had already seen** the film.'},
        {'d': 'Father said, "The doctor had arrived."', 'i': 'Father said that the doctor **had arrived**.'},
        {'d': 'She said, "I had been reading for two hours."', 'i': 'She said that she **had been reading** for two hours.'},
        {'d': 'He said to me, "We had been working together."', 'i': 'He told me that they **had been working** together.'},
        {'d': 'They said, "It had been raining all day."', 'i': 'They said that it **had been raining** all day.'},
        {'d': 'The man said, "I had known him for years."', 'i': 'The man said that he **had known** him for years.'},
        {'d': 'Mina said to her friend, "I had been waiting at the bus stop."', 'i': 'Mina told her friend that she **had been waiting** at the bus stop.'},
    ])
TENSE_GROUPS += _tense_group(
    '৩.৮', 'Future Tense ও Modal Auxiliary-এর পরিবর্তন',
    'shall / will → would, will be → would be, will have → would have, can → could, may → might, must → had to।',
    [
        {'d': 'He said, "I will help you."', 'i': 'He said that he **would** help me.'},
        {'d': 'She said to me, "I shall go to Dhaka."', 'i': 'She told me that she **would** go to Dhaka.'},
        {'d': 'Rahim said, "I will be playing football."', 'i': 'Rahim said that he **would be playing** football.'},
        {'d': 'They said, "We will have completed the project."', 'i': 'They said that they **would have completed** the project.'},
        {'d': 'Kamal said, "I will have been living here."', 'i': 'Kamal said that he **would have been living there**.'},
        {'d': 'She said to him, "I can solve this problem."', 'i': 'She told him that she **could** solve **that** problem.'},
        {'d': 'Father said, "It may rain tonight."', 'i': 'Father said that it **might** rain **that night**.'},
        {'d': 'The teacher said to me, "You should read the book."', 'i': 'The teacher told me that I **should** read the book.'},
        {'d': 'Rina said, "I will write a letter tomorrow."', 'i': 'Rina said that she **would** write a letter **the next day**.'},
        {'d': 'He said to us, "You must obey rules."', 'i': 'He told us that we **had to** obey rules.'},
    ])

SECTION_3_TAIL = [
    {'t': 'practice', 'title': 'অনুশীলন — টেন্স পরিবর্তন (Tense Practice Exercises)',
     'items': [
         'He says, "I write a letter."',
         'She said, "I am drawing a picture."',
         'Rahim said, "I have bought a car."',
         'The boy said, "I have been waiting for an hour."',
         'Kamal said to me, "I saw your brother yesterday."',
         'Rina said, "I was cooking dinner."',
         'The teacher said, "The earth moves round the sun."',
         'He said to me, "I will call you tomorrow."',
         'She said, "I will be waiting at the station."',
         'They said, "We had already completed the assignment."',
     ]},
    {'t': 'answers', 'title': 'উত্তরমালা — টেন্স পরিবর্তন (Tense Practice Answers)',
     'items': [
         'He says that he writes a letter. (Reporting Verb Present)',
         'She said that she was drawing a picture.',
         'Rahim said that he had bought a car.',
         'The boy said that he had been waiting for an hour.',
         'Kamal told me that he had seen my brother the previous day.',
         'Rina said that she had been cooking dinner.',
         'The teacher said that the earth moves round the sun. (Universal Truth)',
         'He told me that he would call me the next day.',
         'She said that she would be waiting at the station.',
         'They said that they had already completed the assignment.',
     ]},
]
