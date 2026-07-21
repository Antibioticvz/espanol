/**
 * Реальные образцы курса (см. docs/SPEC_COMBINE.md, задание renderer-агента: "shared/course/topic-02.txt —
 * реальный входной текст (для мок-данных)"). Тексты скопированы 1:1 из shared/course/*.txt и
 * shared/sample-lessons/topic-04.txt на момент разработки, чтобы:
 *  - не зависеть от чтения файлов вне пакета combine/ (это ломало бы `vite build`/`dev:web`
 *    из-за server.fs.allow и границ workspace-root);
 *  - mockAdapter мог парсить их РЕАЛЬНЫМ ParserService (docs/DECISIONS.md D-04: "полный локальный
 *    цикл разработки... без единого платного запроса", по духу распространяем и на реалистичность мок-данных).
 *
 * Живёт в lib/ (а не adapters/mock-data/), т.к. это адаптер-агностичные ДАННЫЕ: их использует и
 * mockAdapter (для библиотеки/генерации), и ImportScreen напрямую (кнопка «Вставить пример» — работает
 * независимо от того, ipcAdapter сейчас активен или mockAdapter, это просто заготовка текста для UI).
 *
 * Если исходники в shared/course обновятся, эти константы могут немного отстать — это ожидаемо
 * для демонстрационных данных и не влияет на прод-логику (она целиком в core/, не здесь).
 */

export const SAMPLE_TOPIC_02_RAW = `#TOPIC 2 | Готовка и кухня

##BLOCK verb_group | Готовка — глаголы действия

#WORD cocinar | готовить
Voy a cocinar el almuerzo, ¿me ayudas? | Я приготовлю обед, поможешь мне?
¿Qué vamos a cocinar hoy, pescado o pollo? | Что будем готовить сегодня, рыбу или курицу?
Cocino mejor cuando tengo tiempo tranquilo. | Я готовлю лучше, когда есть спокойное время.

#WORD preparar | готовить / накрывать
Estoy preparando la cena, dame diez minutos. | Я готовлю ужин, дай мне десять минут.
¿Puedes preparar la ensalada mientras yo hago el arroz? | Можешь приготовить салат, пока я делаю рис?
Siempre preparo el desayuno rápido entre semana. | Я всегда готовлю завтрак быстро в будни.

#WORD cortar | резать
¿Puedes cortar las verduras mientras yo caliento el aceite? | Можешь порезать овощи, пока я разогреваю масло?
Corta el pan en rebanadas finas, por favor. | Порежь хлеб тонкими ломтиками, пожалуйста.
Este cuchillo no corta bien, necesito otro. | Этот нож плохо режет, мне нужен другой.

#WORD picar | мелко резать
Necesito picar el ajo para la salsa. | Мне нужно мелко порезать чеснок для соуса.
¿Picaste la cebolla ya, o la pico yo? | Ты уже порезал(а) лук, или мне порезать?
Pica la carne en trozos pequeños. | Нарежь мясо мелкими кусочками.

#WORD mezclar | смешивать
Mezcla la harina con los huevos, por favor. | Смешай, пожалуйста, муку с яйцами.
No mezcles la salsa picante con la de los niños. | Не смешивай острый соус с тем, что для детей.
Voy a mezclar todos los ingredientes secos primero. | Сначала я смешаю все сухие ингредиенты.

#WORD calentar | разогревать
Voy a calentar la comida de ayer. | Я разогрею вчерашнюю еду.
¿Puedes calentar el horno a 180 grados? | Можешь разогреть духовку до 180 градусов?
La sopa ya está caliente, no la calientes más. | Суп уже горячий, не разогревай больше.

#WORD hervir | кипятить
El agua ya está hirviendo, echa la pasta. | Вода уже кипит, клади макароны.
Hierve las papas por veinte minutos. | Кипяти картошку двадцать минут.
El arroz tarda menos en hervir que las papas. | Рис закипает быстрее, чем картошка.

#WORD freír | жарить
Estoy friendo unos huevos para el desayuno. | Я жарю яйца на завтрак.
No frías el pescado con tanto aceite. | Не жарь рыбу с таким количеством масла.
Frío las papas hasta que estén doradas. | Жарю картошку, пока не станет золотистой.

#WORD hornear | печь в духовке
Vamos a hornear galletas juntos esta tarde. | Давай сегодня вечером испечём печенье вместе.
Hay que hornear el pollo una hora más. | Курицу нужно печь ещё час.
Este pastel se hornea a temperatura baja. | Этот пирог печётся при низкой температуре.

##BLOCK verb_group | Взаимодействие с семьёй

#WORD lavarse | мыть(ся)
Lávate las manos antes de comer. | Помой руки перед едой.
Voy a lavar los platos después de cenar. | Я помою посуду после ужина.
¿Ya lavaste las frutas? | Ты уже помыл(а) фрукты?

#WORD poner la mesa | накрывать на стол
¿Me ayudas a poner la mesa? | Поможешь накрыть на стол?
Pon los vasos y los platos, por favor. | Поставь стаканы и тарелки, пожалуйста.
Ya puse los cubiertos, falta el pan. | Я уже поставил(а) приборы, не хватает хлеба.

#WORD ayudar | помогать
¿Me ayudas a pelar las papas? | Поможешь почистить картошку?
Mi hija siempre ayuda a poner la mesa. | Моя дочь всегда помогает накрывать на стол.
¿Necesitas ayuda con la cena? | Тебе нужна помощь с ужином?

#WORD probar | пробовать
¿Quieres probar la salsa? Dime si le falta sal. | Хочешь попробовать соус? Скажи, не хватает ли соли.
Prueba esto, creo que le falta un poco de limón. | Попробуй это, кажется, не хватает лимона.
Mi hija nunca ha probado la comida picante. | Моя дочь никогда не пробовала острую еду.

#WORD pedir | просить
Mi hijo siempre pide probar la comida antes de que esté lista. | Мой сын всегда просит попробовать еду до того, как она готова.
Te pido que no toques la sartén, está caliente. | Прошу тебя не трогать сковородку, она горячая.
Le pedí a mi esposa que comprara más sal. | Я попросил жену купить ещё соли.

#WORD tener cuidado | быть осторожным
Ten cuidado, la sartén está caliente. | Будь осторожен, сковородка горячая.
Tengo mucha hambre, ¿ya casi está la comida? | Я очень голоден, еда уже почти готова?
Los niños tienen que tener cuidado con el cuchillo. | Детям нужно быть осторожными с ножом.

##BLOCK verb_group | Завершение

#WORD servir | подавать
Voy a servir la sopa en un momento. | Я подам суп через минуту.
Sírvete más arroz si quieres. | Положи себе ещё риса, если хочешь.
¿Te sirvo un poco más de agua? | Налить тебе ещё немного воды?

#WORD guardar | убирать на хранение
Voy a guardar las sobras en la nevera. | Я уберу остатки в холодильник.
Guarda el pan en la bolsa, se pone duro rápido. | Убери хлеб в пакет, он быстро черствеет.
¿Dónde guardamos las especias? | Куда мы убираем специи?

#WORD limpiar | убирать / чистить
Después de cocinar, siempre limpio la cocina. | После готовки я всегда убираю кухню.
¿Puedes limpiar la mesa mientras yo lavo los platos? | Можешь протереть стол, пока я мою посуду?
Hay que limpiar el piso, se cayó aceite. | Нужно вымыть пол, пролилось масло.

##BLOCK phrase_group | Ходовые фразы — где, хочу, нужно

#CATEGORY Где что лежит
¿Dónde está la sal? | Где соль?
¿Dónde están los platos? | Где тарелки?
¿Sabes dónde dejé el abrelatas? | Знаешь, куда я положил открывашку?

#CATEGORY Хочу / не хочу
Quiero un poco más de agua. | Хочу ещё немного воды.
No quiero tanto picante. | Не хочу так остро.
Quiero repetir, estaba muy rico. | Хочу добавки, было очень вкусно.

#CATEGORY Нужно
Necesito el cuchillo grande. | Мне нужен большой нож.
Necesito que me pases la sal. | Мне нужно, чтобы ты передал(а) соль.
Necesitamos comprar más leche. | Нам нужно купить ещё молока.

#CATEGORY Есть / нет в наличии
¿Tenemos leche todavía? | У нас ещё есть молоко?
No hay más pan. | Хлеба больше нет.
Falta sal en esta sopa. | В супе не хватает соли.
Ya no queda aceite. | Масло закончилось.

#CATEGORY Передай / принеси
¿Me pasas el pan, por favor? | Передашь мне хлеб?
¿Puedes alcanzarme un plato? | Можешь подать тарелку?
Tráeme un vaso, por favor. | Принеси мне стакан.

#CATEGORY Готово / не готово
Ya está listo. | Уже готово.
Todavía no está listo. | Ещё не готово.
Está muy caliente, cuidado. | Очень горячее, осторожно.
`

export const SAMPLE_TOPIC_03_RAW = `#TOPIC 3 | Первое свидание

##BLOCK verb_group | Начало встречи

#WORD llegar | приходить / прибывать
Llego a la cita cinco minutos antes. | Я прихожу на свидание на пять минут раньше.
Llegué un poco tarde, había mucho tráfico. | Я немного опоздал, были пробки.
Siempre llego temprano a las citas importantes. | Я всегда прихожу пораньше на важные встречи.

#WORD reconocer | узнавать
La reconocí enseguida por la foto de su perfil. | Я сразу узнал её по фото из профиля.
No la reconocí al principio, se veía diferente. | Сначала я её не узнал, она выглядела иначе.
Es fácil reconocerla, lleva una chaqueta roja. | Её легко узнать, на ней красная куртка.

#WORD saludar | здороваться
La saludé con un abrazo, no un beso. | Я поздоровался с ней объятием, а не поцелуем.
Nos saludamos con una sonrisa nerviosa. | Мы поздоровались с нервной улыбкой.
Prefiero saludar con confianza aunque esté nervioso. | Предпочитаю здороваться уверенно, даже если нервничаю.

#WORD sentarse | садиться
Nos sentamos en una mesa cerca de la ventana. | Мы сели за столик у окна.
¿Nos sentamos aquí o prefieres la terraza? | Сядем здесь, или предпочитаешь террасу?
Me senté frente a ella para poder conversar bien. | Я сел напротив неё, чтобы удобно было разговаривать.

#WORD pedir | заказывать
Voy a pedir una copa de vino tinto. | Закажу бокал красного вина.
¿Qué vas a pedir tú? | Что закажешь ты?
Pedimos algo para compartir. | Мы заказали что-то на двоих.

#WORD hablar | разговаривать
Hablamos de todo un poco, sin silencios incómodos. | Мы поговорили обо всём понемногу, без неловкого молчания.
Me gusta hablar con alguien que escucha de verdad. | Мне нравится общаться с тем, кто по-настоящему слушает.
Hablamos por dos horas sin darnos cuenta. | Мы проговорили два часа, не заметив этого.

#WORD preguntar | спрашивать
Le pregunté a qué se dedica. | Я спросил, чем она занимается.
Me preguntó si tengo hijos, y le dije la verdad. | Она спросила, есть ли у меня дети, и я сказал правду.
Prefiero preguntar cosas interesantes, no solo de trabajo. | Предпочитаю спрашивать что-то интересное, а не только про работу.

#WORD reírse | смеяться
Nos reímos mucho con sus historias. | Мы много смеялись над её историями.
Me hizo reír desde el primer minuto. | Она рассмешила меня с первой минуты.
Si no me río en una cita, algo falla. | Если я не смеюсь на свидании, что-то не так.

##BLOCK verb_group | Связь и эмоции

#WORD gustar | нравиться
Me gusta su forma de hablar. | Мне нравится, как она говорит.
Creo que le gusté, sonreía todo el tiempo. | Кажется, я ей понравился, она всё время улыбалась.
¿Te gustaría repetir esto otro día? | Тебе бы хотелось повторить это в другой раз?

#WORD interesar | интересовать
Me interesa saber más de su vida. | Мне интересно узнать больше о её жизни.
Le interesó mucho mi trabajo como programador. | Её очень заинтересовала моя работа программиста.
No me interesan las conversaciones superficiales. | Меня не интересуют поверхностные разговоры.

#WORD sentirse | чувствовать (себя)
Me sentí cómodo desde el principio. | Я почувствовал себя комфортно с самого начала.
¿Cómo te sientes en las primeras citas? | Как ты себя чувствуешь на первых свиданиях?
Sentí una conexión rara, en el buen sentido. | Я почувствовал странную связь, в хорошем смысле.

#WORD atreverse | осмеливаться / решаться
Me atreví a preguntarle si quería salir otra vez. | Я осмелился спросить, хочет ли она встретиться снова.
No me atreví a darle un beso en la primera cita. | Я не решился поцеловать её на первом свидании.
Al final me atreví a ser yo mismo. | В итоге я решился быть самим собой.

#WORD coincidir | совпадать
Coincidimos en casi todo, hasta en la música. | У нас совпало почти всё, даже музыка.
Nuestros horarios no coinciden mucho esta semana. | Наши графики не очень совпадают на этой неделе.
Es raro coincidir tanto con alguien en la primera cita. | Редко так совпадаешь с кем-то на первом свидании.

#WORD hacer match | «смэтчиться» в приложении
Hicimos match hace dos semanas. | Мы «заматчились» две недели назад.
No hago match con mucha gente en la aplicación. | Я не так часто «мэтчусь» с людьми в приложении.
Cuando hacemos match, prefiero escribir yo primero. | Когда происходит «мэтч», я предпочитаю писать первым.

##BLOCK verb_group | Завершение свидания

#WORD invitar | приглашать / угощать
Quiero invitarte a cenar la próxima vez. | Хочу пригласить тебя на ужин в следующий раз.
Ella me invitó a tomar algo después. | Она пригласила меня выпить что-нибудь после.
Insistí en invitar yo esta vez. | Я настоял на том, чтобы угостить в этот раз.

#WORD pagar | платить
Insistí en pagar la cuenta yo. | Я настоял на том, чтобы заплатить за счёт.
¿Pagamos cada uno lo suyo? | Заплатим каждый за себя?
Ella quiso pagar la mitad. | Она захотела заплатить половину.

#WORD acompañar | провожать
La acompañé hasta su carro. | Я проводил её до машины.
¿Te acompaño hasta la parada? | Проводить тебя до остановки?
Me ofrecí a acompañarla a casa. | Я предложил проводить её домой.

#WORD despedirse | прощаться
Nos despedimos con un abrazo. | Мы попрощались объятием.
Es difícil despedirse cuando la pasas bien. | Трудно прощаться, когда хорошо проводишь время.
Nos despedimos sin saber si nos veríamos otra vez. | Мы попрощались, не зная, увидимся ли снова.

#WORD escribir | писать
Le escribí esa misma noche. | Я написал ей в тот же вечер.
¿Le escribo yo primero o espero? | Написать мне первым, или подождать?
Nos escribimos todos los días desde la cita. | Мы переписываемся каждый день с того свидания.

#WORD proponer | предлагать
Le propuse vernos el sábado. | Я предложил встретиться в субботу.
Me propuso ir al cine la próxima vez. | Она предложила сходить в кино в следующий раз.
Voy a proponerle algo diferente para la segunda cita. | Предложу ей что-то другое для второго свидания.

#WORD repetir | повторить
Quiero repetir esta cita pronto. | Хочу повторить это свидание поскорее.
¿Repetimos la próxima semana? | Повторим на следующей неделе?
Definitivamente quiero repetir esto. | Я точно хочу это повторить.

##BLOCK phrase_group | Ходовые фразы

#CATEGORY Где
¿Dónde quedamos? | Где встретимся?
¿Dónde nos sentamos, aquí o allá? | Где сядем, тут или там?
¿Sabes dónde está el baño? | Знаешь, где туалет?

#CATEGORY Хочу
Quiero conocerte mejor. | Хочу узнать тебя получше.
No quiero que la noche termine tan rápido. | Не хочу, чтобы вечер так быстро закончился.
Quiero verte otra vez. | Хочу увидеться снова.

#CATEGORY Нужно
Necesito confirmarte la hora exacta. | Мне нужно подтвердить тебе точное время.
Necesito ir un momento al baño. | Мне нужно на минутку в туалет.
Necesitamos hablar de esto con calma. | Нам нужно спокойно об этом поговорить.

#CATEGORY Есть / нет
¿Tienes planes para el fin de semana? | У тебя есть планы на выходные?
No tengo muchas citas por Tinder, la verdad. | У меня, если честно, не так много свиданий через Tinder.
¿Hay algo que no te guste de las primeras citas? | Есть что-то, что тебе не нравится в первых свиданиях?

#CATEGORY Можно ли
¿Te puedo hacer una pregunta un poco personal? | Могу задать тебе немного личный вопрос?
¿Puedo invitarte la próxima vez? | Могу я угостить тебя в следующий раз?
¿Podemos vernos otra vez pronto? | Можем мы увидеться снова, скоро?

#CATEGORY Нравится / интересует
¿Te gusta este lugar? | Тебе нравится это место?
Me gusta cómo hablas de tu trabajo. | Мне нравится, как ты рассказываешь о своей работе.
¿Qué es lo que más te gusta hacer los fines de semana? | Что тебе больше всего нравится делать по выходным?

#CATEGORY Договориться на потом
Escríbeme cuando llegues a casa. | Напиши мне, когда доберёшься домой.
Avísame si quieres repetir esto. | Дай знать, если захочешь повторить это.
Quedamos la próxima semana, entonces. | Тогда договорились на следующую неделю.

##BLOCK vocabulary | Ключевая лексика
la cita | свидание
la primera / segunda cita | первое / второе свидание
Tinder / la app de citas | Tinder / приложение знакомств
el perfil | профиль
hacer match | «смэтчиться» (совпасть в приложении)
deslizar (a la derecha) | свайпнуть (вправо)
conocer(se) | знакомиться / узнавать друг друга
la conexión | химия / связь между людьми
nervioso/a | нервный / взволнованный
coqueto/a | кокетливый
la confianza | доверие / уверенность в себе
el silencio incómodo | неловкое молчание
gracioso/a | забавный
sincero/a | искренний

##BLOCK story | Короткий рассказ
ES: Conocí a Camila por Tinder hace dos semanas, e hicimos match casi enseguida. Hoy tuvimos nuestra primera cita en un café del centro. Llegué diez minutos antes, un poco nervioso. La reconocí enseguida por la foto de su perfil, aunque en persona sonreía todavía más. Nos saludamos con un abrazo y nos sentamos cerca de la ventana. Pedimos café y hablamos casi dos horas, sin silencios incómodos. Le pregunté a qué se dedica, y ella me preguntó por mi trabajo como programador. Coincidimos en muchas cosas, hasta en la música. Al final insistí en pagar la cuenta y la acompañé hasta su carro. Nos despedimos con una sonrisa, y esa misma noche le escribí para proponerle una segunda cita. Quiero repetir esto pronto.
RU: Я познакомился с Камилой через Tinder две недели назад, и мы «заматчились» почти сразу. Сегодня у нас было первое свидание в кафе в центре. Я пришёл на десять минут раньше, немного нервничая. Я сразу узнал её по фото из профиля, хотя вживую она улыбалась ещё больше. Мы поздоровались объятием и сели у окна. Мы заказали кофе и проговорили почти два часа без неловкого молчания. Я спросил, чем она занимается, а она спросила меня про мою работу программиста. У нас совпало многое, даже музыкальные вкусы. В конце я настоял на том, чтобы заплатить за счёт, и проводил её до машины. Мы попрощались с улыбкой, и в тот же вечер я написал ей, чтобы предложить второе свидание. Хочу повторить это поскорее.
`

/** Компактный образец со всеми 4 типами блоков (verb_group/phrase_group/vocabulary/story) — см.
 * combine/src/core/parser/parser.service.test.ts (9 фраз, 4 слова, 1 рассказ, 4 блока — уже проверено тестом ядра). */
export const SAMPLE_TOPIC_04_RAW = `#TOPIC 4 | Рассказ о себе

##BLOCK verb_group | Кто я — происхождение и факты

#WORD llamarse | зваться
Me llamo Victor. | Меня зовут Виктор.
¿Cómo te llamas tú? | Как тебя зовут?
Todos me llaman Vic, para abreviar. | Все зовут меня Вик, для краткости.

#WORD tener | иметь (возраст)
Tengo cuarenta años. | Мне сорок лет.
¿Cuántos años tienes tú? | Сколько лет тебе?

##BLOCK phrase_group | Ходовые фразы

#CATEGORY Первое знакомство
Mucho gusto, soy Victor. | Очень приятно, я Виктор.
Encantado de conocerte. | Приятно познакомиться.

#CATEGORY О работе
Soy programador. | Я программист.
Trabajo a distancia. | Я работаю удалённо.

##BLOCK vocabulary | Ключевая лексика
el programador | программист
a distancia | удалённо
la familia | семья
el hermano | брат

##BLOCK story | Короткий рассказ
ES: Me llamo Victor y tengo cuarenta años. Soy programador y trabajo a distancia. Tengo una familia grande y un hermano menor.
RU: Меня зовут Виктор, мне сорок лет. Я программист и работаю удалённо. У меня большая семья и младший брат.
`
