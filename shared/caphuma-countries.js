const CapHumaCountries = (() => {
    const LIST = [
        { code: 'ZA', nameFr: 'Afrique du Sud', nameEn: 'South Africa', nationalityFr: 'sud-africaine', nationalityEn: 'South African' },
        { code: 'DZ', nameFr: 'Algérie', nameEn: 'Algeria', nationalityFr: 'algérienne', nationalityEn: 'Algerian' },
        { code: 'AO', nameFr: 'Angola', nameEn: 'Angola', nationalityFr: 'angolaise', nationalityEn: 'Angolan' },
        { code: 'BJ', nameFr: 'Bénin', nameEn: 'Benin', nationalityFr: 'béninoise', nationalityEn: 'Beninese' },
        { code: 'BW', nameFr: 'Botswana', nameEn: 'Botswana', nationalityFr: 'botswanaise', nationalityEn: 'Botswanan' },
        { code: 'BF', nameFr: 'Burkina Faso', nameEn: 'Burkina Faso', nationalityFr: 'burkinabée', nationalityEn: 'Burkinabe' },
        { code: 'BI', nameFr: 'Burundi', nameEn: 'Burundi', nationalityFr: 'burundaise', nationalityEn: 'Burundian' },
        { code: 'CV', nameFr: 'Cap-Vert', nameEn: 'Cape Verde', nationalityFr: 'cap-verdienne', nationalityEn: 'Cabo Verdean' },
        { code: 'CM', nameFr: 'Cameroun', nameEn: 'Cameroon', nationalityFr: 'camerounaise', nationalityEn: 'Cameroonian' },
        { code: 'CF', nameFr: 'République centrafricaine', nameEn: 'Central African Republic', nationalityFr: 'centrafricaine', nationalityEn: 'Central African' },
        { code: 'KM', nameFr: 'Comores', nameEn: 'Comoros', nationalityFr: 'comorienne', nationalityEn: 'Comoran' },
        { code: 'CG', nameFr: 'Congo', nameEn: 'Congo', nationalityFr: 'congolaise', nationalityEn: 'Congolese' },
        // Distingué de CG : même gentilé « congolaise ».
        { code: 'CD', nameFr: 'République démocratique du Congo', nameEn: 'DR Congo', nationalityFr: 'congolaise RD', nationalityEn: 'Congolese (DRC)' },
        { code: 'CI', nameFr: "Côte d'Ivoire", nameEn: 'Ivory Coast', nationalityFr: 'ivoirienne', nationalityEn: 'Ivorian' },
        { code: 'DJ', nameFr: 'Djibouti', nameEn: 'Djibouti', nationalityFr: 'djiboutienne', nationalityEn: 'Djiboutian' },
        { code: 'EG', nameFr: 'Égypte', nameEn: 'Egypt', nationalityFr: 'égyptienne', nationalityEn: 'Egyptian' },
        { code: 'ER', nameFr: 'Érythrée', nameEn: 'Eritrea', nationalityFr: 'érythréenne', nationalityEn: 'Eritrean' },
        { code: 'SZ', nameFr: 'Eswatini', nameEn: 'Eswatini', nationalityFr: 'swazie', nationalityEn: 'Swazi' },
        { code: 'ET', nameFr: 'Éthiopie', nameEn: 'Ethiopia', nationalityFr: 'éthiopienne', nationalityEn: 'Ethiopian' },
        { code: 'GA', nameFr: 'Gabon', nameEn: 'Gabon', nationalityFr: 'gabonaise', nationalityEn: 'Gabonese' },
        { code: 'GM', nameFr: 'Gambie', nameEn: 'Gambia', nationalityFr: 'gambienne', nationalityEn: 'Gambian' },
        { code: 'GH', nameFr: 'Ghana', nameEn: 'Ghana', nationalityFr: 'ghanéenne', nationalityEn: 'Ghanaian' },
        { code: 'GN', nameFr: 'Guinée', nameEn: 'Guinea', nationalityFr: 'guinéenne', nationalityEn: 'Guinean' },
        { code: 'GW', nameFr: 'Guinée-Bissau', nameEn: 'Guinea-Bissau', nationalityFr: 'bissau-guinéenne', nationalityEn: 'Bissau-Guinean' },
        { code: 'GQ', nameFr: 'Guinée équatoriale', nameEn: 'Equatorial Guinea', nationalityFr: 'équato-guinéenne', nationalityEn: 'Equatorial Guinean' },
        { code: 'KE', nameFr: 'Kenya', nameEn: 'Kenya', nationalityFr: 'kényane', nationalityEn: 'Kenyan' },
        { code: 'LS', nameFr: 'Lesotho', nameEn: 'Lesotho', nationalityFr: 'lesothane', nationalityEn: 'Basotho' },
        { code: 'LR', nameFr: 'Liberia', nameEn: 'Liberia', nationalityFr: 'libérienne', nationalityEn: 'Liberian' },
        { code: 'LY', nameFr: 'Libye', nameEn: 'Libya', nationalityFr: 'libyenne', nationalityEn: 'Libyan' },
        { code: 'MG', nameFr: 'Madagascar', nameEn: 'Madagascar', nationalityFr: 'malgache', nationalityEn: 'Malagasy' },
        { code: 'MW', nameFr: 'Malawi', nameEn: 'Malawi', nationalityFr: 'malawite', nationalityEn: 'Malawian' },
        { code: 'ML', nameFr: 'Mali', nameEn: 'Mali', nationalityFr: 'malienne', nationalityEn: 'Malian' },
        { code: 'MA', nameFr: 'Maroc', nameEn: 'Morocco', nationalityFr: 'marocaine', nationalityEn: 'Moroccan' },
        { code: 'MU', nameFr: 'Maurice', nameEn: 'Mauritius', nationalityFr: 'mauricienne', nationalityEn: 'Mauritian' },
        { code: 'MR', nameFr: 'Mauritanie', nameEn: 'Mauritania', nationalityFr: 'mauritanienne', nationalityEn: 'Mauritanian' },
        { code: 'MZ', nameFr: 'Mozambique', nameEn: 'Mozambique', nationalityFr: 'mozambicaine', nationalityEn: 'Mozambican' },
        { code: 'NA', nameFr: 'Namibie', nameEn: 'Namibia', nationalityFr: 'namibienne', nationalityEn: 'Namibian' },
        { code: 'NE', nameFr: 'Niger', nameEn: 'Niger', nationalityFr: 'nigérienne', nationalityEn: 'Nigerien' },
        { code: 'NG', nameFr: 'Nigeria', nameEn: 'Nigeria', nationalityFr: 'nigériane', nationalityEn: 'Nigerian' },
        { code: 'UG', nameFr: 'Ouganda', nameEn: 'Uganda', nationalityFr: 'ougandaise', nationalityEn: 'Ugandan' },
        { code: 'RW', nameFr: 'Rwanda', nameEn: 'Rwanda', nationalityFr: 'rwandaise', nationalityEn: 'Rwandan' },
        { code: 'ST', nameFr: 'Sao Tomé-et-Principe', nameEn: 'São Tomé and Príncipe', nationalityFr: 'santoméenne', nationalityEn: 'São Toméan' },
        { code: 'SN', nameFr: 'Sénégal', nameEn: 'Senegal', nationalityFr: 'sénégalaise', nationalityEn: 'Senegalese' },
        { code: 'SC', nameFr: 'Seychelles', nameEn: 'Seychelles', nationalityFr: 'seychelloise', nationalityEn: 'Seychellois' },
        { code: 'SL', nameFr: 'Sierra Leone', nameEn: 'Sierra Leone', nationalityFr: 'sierra-léonaise', nationalityEn: 'Sierra Leonean' },
        { code: 'SO', nameFr: 'Somalie', nameEn: 'Somalia', nationalityFr: 'somalienne', nationalityEn: 'Somali' },
        { code: 'SD', nameFr: 'Soudan', nameEn: 'Sudan', nationalityFr: 'soudanaise', nationalityEn: 'Sudanese' },
        { code: 'SS', nameFr: 'Soudan du Sud', nameEn: 'South Sudan', nationalityFr: 'sud-soudanaise', nationalityEn: 'South Sudanese' },
        { code: 'TZ', nameFr: 'Tanzanie', nameEn: 'Tanzania', nationalityFr: 'tanzanienne', nationalityEn: 'Tanzanian' },
        { code: 'TD', nameFr: 'Tchad', nameEn: 'Chad', nationalityFr: 'tchadienne', nationalityEn: 'Chadian' },
        { code: 'TG', nameFr: 'Togo', nameEn: 'Togo', nationalityFr: 'togolaise', nationalityEn: 'Togolese' },
        { code: 'TN', nameFr: 'Tunisie', nameEn: 'Tunisia', nationalityFr: 'tunisienne', nationalityEn: 'Tunisian' },
        { code: 'ZM', nameFr: 'Zambie', nameEn: 'Zambia', nationalityFr: 'zambienne', nationalityEn: 'Zambian' },
        { code: 'ZW', nameFr: 'Zimbabwe', nameEn: 'Zimbabwe', nationalityFr: 'zimbabwéenne', nationalityEn: 'Zimbabwean' },

        { code: 'AG', nameFr: 'Antigua-et-Barbuda', nameEn: 'Antigua and Barbuda', nationalityFr: 'antiguaise-et-barbudienne', nationalityEn: 'Antiguan and Barbudan' },
        { code: 'AR', nameFr: 'Argentine', nameEn: 'Argentina', nationalityFr: 'argentine', nationalityEn: 'Argentine' },
        { code: 'BS', nameFr: 'Bahamas', nameEn: 'Bahamas', nationalityFr: 'bahamienne', nationalityEn: 'Bahamian' },
        { code: 'BB', nameFr: 'Barbade', nameEn: 'Barbados', nationalityFr: 'barbadienne', nationalityEn: 'Barbadian' },
        { code: 'BZ', nameFr: 'Belize', nameEn: 'Belize', nationalityFr: 'belizienne', nationalityEn: 'Belizean' },
        { code: 'BO', nameFr: 'Bolivie', nameEn: 'Bolivia', nationalityFr: 'bolivienne', nationalityEn: 'Bolivian' },
        { code: 'BR', nameFr: 'Brésil', nameEn: 'Brazil', nationalityFr: 'brésilienne', nationalityEn: 'Brazilian' },
        { code: 'CA', nameFr: 'Canada', nameEn: 'Canada', nationalityFr: 'canadienne', nationalityEn: 'Canadian' },
        { code: 'CL', nameFr: 'Chili', nameEn: 'Chile', nationalityFr: 'chilienne', nationalityEn: 'Chilean' },
        { code: 'CO', nameFr: 'Colombie', nameEn: 'Colombia', nationalityFr: 'colombienne', nationalityEn: 'Colombian' },
        { code: 'CR', nameFr: 'Costa Rica', nameEn: 'Costa Rica', nationalityFr: 'costaricienne', nationalityEn: 'Costa Rican' },
        { code: 'CU', nameFr: 'Cuba', nameEn: 'Cuba', nationalityFr: 'cubaine', nationalityEn: 'Cuban' },
        // nationalityEn distinct de DO : « Dominican » seul est ambigu.
        { code: 'DM', nameFr: 'Dominique', nameEn: 'Dominica', nationalityFr: 'dominiquaise', nationalityEn: 'Dominican (Dominica)' },
        { code: 'DO', nameFr: 'République dominicaine', nameEn: 'Dominican Republic', nationalityFr: 'dominicaine', nationalityEn: 'Dominican' },
        { code: 'EC', nameFr: 'Équateur', nameEn: 'Ecuador', nationalityFr: 'équatorienne', nationalityEn: 'Ecuadorian' },
        { code: 'US', nameFr: 'États-Unis', nameEn: 'United States', nationalityFr: 'américaine', nationalityEn: 'American' },
        { code: 'GD', nameFr: 'Grenade', nameEn: 'Grenada', nationalityFr: 'grenadienne', nationalityEn: 'Grenadian' },
        { code: 'GT', nameFr: 'Guatemala', nameEn: 'Guatemala', nationalityFr: 'guatémaltèque', nationalityEn: 'Guatemalan' },
        { code: 'GY', nameFr: 'Guyana', nameEn: 'Guyana', nationalityFr: 'guyanienne', nationalityEn: 'Guyanese' },
        { code: 'HT', nameFr: 'Haïti', nameEn: 'Haiti', nationalityFr: 'haïtienne', nationalityEn: 'Haitian' },
        { code: 'HN', nameFr: 'Honduras', nameEn: 'Honduras', nationalityFr: 'hondurienne', nationalityEn: 'Honduran' },
        { code: 'JM', nameFr: 'Jamaïque', nameEn: 'Jamaica', nationalityFr: 'jamaïcaine', nationalityEn: 'Jamaican' },
        { code: 'MX', nameFr: 'Mexique', nameEn: 'Mexico', nationalityFr: 'mexicaine', nationalityEn: 'Mexican' },
        { code: 'NI', nameFr: 'Nicaragua', nameEn: 'Nicaragua', nationalityFr: 'nicaraguayenne', nationalityEn: 'Nicaraguan' },
        { code: 'PA', nameFr: 'Panama', nameEn: 'Panama', nationalityFr: 'panaméenne', nationalityEn: 'Panamanian' },
        { code: 'PY', nameFr: 'Paraguay', nameEn: 'Paraguay', nationalityFr: 'paraguayenne', nationalityEn: 'Paraguayan' },
        { code: 'PE', nameFr: 'Pérou', nameEn: 'Peru', nationalityFr: 'péruvienne', nationalityEn: 'Peruvian' },
        { code: 'KN', nameFr: 'Saint-Christophe-et-Niévès', nameEn: 'Saint Kitts and Nevis', nationalityFr: 'kittitienne', nationalityEn: 'Kittitian and Nevisian' },
        { code: 'LC', nameFr: 'Sainte-Lucie', nameEn: 'Saint Lucia', nationalityFr: 'saint-lucienne', nationalityEn: 'Saint Lucian' },
        { code: 'VC', nameFr: 'Saint-Vincent-et-les-Grenadines', nameEn: 'Saint Vincent and the Grenadines', nationalityFr: 'saint-vincentaise', nationalityEn: 'Vincentian' },
        { code: 'SV', nameFr: 'Salvador', nameEn: 'El Salvador', nationalityFr: 'salvadorienne', nationalityEn: 'Salvadoran' },
        { code: 'SR', nameFr: 'Suriname', nameEn: 'Suriname', nationalityFr: 'surinamaise', nationalityEn: 'Surinamese' },
        { code: 'TT', nameFr: 'Trinité-et-Tobago', nameEn: 'Trinidad and Tobago', nationalityFr: 'trinidadienne', nationalityEn: 'Trinidadian' },
        { code: 'UY', nameFr: 'Uruguay', nameEn: 'Uruguay', nationalityFr: 'uruguayenne', nationalityEn: 'Uruguayan' },
        { code: 'VE', nameFr: 'Venezuela', nameEn: 'Venezuela', nationalityFr: 'vénézuélienne', nationalityEn: 'Venezuelan' },

        { code: 'DE', nameFr: 'Allemagne', nameEn: 'Germany', nationalityFr: 'allemande', nationalityEn: 'German' },
        { code: 'AL', nameFr: 'Albanie', nameEn: 'Albania', nationalityFr: 'albanaise', nationalityEn: 'Albanian' },
        { code: 'AD', nameFr: 'Andorre', nameEn: 'Andorra', nationalityFr: 'andorrane', nationalityEn: 'Andorran' },
        { code: 'AT', nameFr: 'Autriche', nameEn: 'Austria', nationalityFr: 'autrichienne', nationalityEn: 'Austrian' },
        { code: 'BE', nameFr: 'Belgique', nameEn: 'Belgium', nationalityFr: 'belge', nationalityEn: 'Belgian' },
        { code: 'BY', nameFr: 'Biélorussie', nameEn: 'Belarus', nationalityFr: 'biélorusse', nationalityEn: 'Belarusian' },
        { code: 'BA', nameFr: 'Bosnie-Herzégovine', nameEn: 'Bosnia and Herzegovina', nationalityFr: 'bosnienne', nationalityEn: 'Bosnian' },
        { code: 'BG', nameFr: 'Bulgarie', nameEn: 'Bulgaria', nationalityFr: 'bulgare', nationalityEn: 'Bulgarian' },
        { code: 'CY', nameFr: 'Chypre', nameEn: 'Cyprus', nationalityFr: 'chypriote', nationalityEn: 'Cypriot' },
        { code: 'HR', nameFr: 'Croatie', nameEn: 'Croatia', nationalityFr: 'croate', nationalityEn: 'Croatian' },
        { code: 'DK', nameFr: 'Danemark', nameEn: 'Denmark', nationalityFr: 'danoise', nationalityEn: 'Danish' },
        { code: 'ES', nameFr: 'Espagne', nameEn: 'Spain', nationalityFr: 'espagnole', nationalityEn: 'Spanish' },
        { code: 'EE', nameFr: 'Estonie', nameEn: 'Estonia', nationalityFr: 'estonienne', nationalityEn: 'Estonian' },
        { code: 'FI', nameFr: 'Finlande', nameEn: 'Finland', nationalityFr: 'finlandaise', nationalityEn: 'Finnish' },
        { code: 'FR', nameFr: 'France', nameEn: 'France', nationalityFr: 'française', nationalityEn: 'French' },
        { code: 'GR', nameFr: 'Grèce', nameEn: 'Greece', nationalityFr: 'grecque', nationalityEn: 'Greek' },
        { code: 'HU', nameFr: 'Hongrie', nameEn: 'Hungary', nationalityFr: 'hongroise', nationalityEn: 'Hungarian' },
        { code: 'IE', nameFr: 'Irlande', nameEn: 'Ireland', nationalityFr: 'irlandaise', nationalityEn: 'Irish' },
        { code: 'IS', nameFr: 'Islande', nameEn: 'Iceland', nationalityFr: 'islandaise', nationalityEn: 'Icelandic' },
        { code: 'IT', nameFr: 'Italie', nameEn: 'Italy', nationalityFr: 'italienne', nationalityEn: 'Italian' },
        // XK : code hors ISO 3166-1, en usage de fait pour le Kosovo.
        { code: 'XK', nameFr: 'Kosovo', nameEn: 'Kosovo', nationalityFr: 'kosovare', nationalityEn: 'Kosovar' },
        { code: 'LV', nameFr: 'Lettonie', nameEn: 'Latvia', nationalityFr: 'lettone', nationalityEn: 'Latvian' },
        { code: 'LI', nameFr: 'Liechtenstein', nameEn: 'Liechtenstein', nationalityFr: 'liechtensteinoise', nationalityEn: 'Liechtensteiner' },
        { code: 'LT', nameFr: 'Lituanie', nameEn: 'Lithuania', nationalityFr: 'lituanienne', nationalityEn: 'Lithuanian' },
        { code: 'LU', nameFr: 'Luxembourg', nameEn: 'Luxembourg', nationalityFr: 'luxembourgeoise', nationalityEn: 'Luxembourger' },
        { code: 'MK', nameFr: 'Macédoine du Nord', nameEn: 'North Macedonia', nationalityFr: 'macédonienne', nationalityEn: 'Macedonian' },
        { code: 'MT', nameFr: 'Malte', nameEn: 'Malta', nationalityFr: 'maltaise', nationalityEn: 'Maltese' },
        { code: 'MD', nameFr: 'Moldavie', nameEn: 'Moldova', nationalityFr: 'moldave', nationalityEn: 'Moldovan' },
        { code: 'MC', nameFr: 'Monaco', nameEn: 'Monaco', nationalityFr: 'monégasque', nationalityEn: 'Monégasque' },
        { code: 'ME', nameFr: 'Monténégro', nameEn: 'Montenegro', nationalityFr: 'monténégrine', nationalityEn: 'Montenegrin' },
        { code: 'NO', nameFr: 'Norvège', nameEn: 'Norway', nationalityFr: 'norvégienne', nationalityEn: 'Norwegian' },
        { code: 'NL', nameFr: 'Pays-Bas', nameEn: 'Netherlands', nationalityFr: 'néerlandaise', nationalityEn: 'Dutch' },
        { code: 'PL', nameFr: 'Pologne', nameEn: 'Poland', nationalityFr: 'polonaise', nationalityEn: 'Polish' },
        { code: 'PT', nameFr: 'Portugal', nameEn: 'Portugal', nationalityFr: 'portugaise', nationalityEn: 'Portuguese' },
        { code: 'RO', nameFr: 'Roumanie', nameEn: 'Romania', nationalityFr: 'roumaine', nationalityEn: 'Romanian' },
        { code: 'GB', nameFr: 'Royaume-Uni', nameEn: 'United Kingdom', nationalityFr: 'britannique', nationalityEn: 'British' },
        { code: 'RU', nameFr: 'Russie', nameEn: 'Russia', nationalityFr: 'russe', nationalityEn: 'Russian' },
        { code: 'SM', nameFr: 'Saint-Marin', nameEn: 'San Marino', nationalityFr: 'saint-marinaise', nationalityEn: 'Sammarinese' },
        { code: 'VA', nameFr: 'Saint-Siège (Vatican)', nameEn: 'Holy See (Vatican)', nationalityFr: 'vaticane', nationalityEn: 'Vatican' },
        { code: 'RS', nameFr: 'Serbie', nameEn: 'Serbia', nationalityFr: 'serbe', nationalityEn: 'Serbian' },
        { code: 'SK', nameFr: 'Slovaquie', nameEn: 'Slovakia', nationalityFr: 'slovaque', nationalityEn: 'Slovak' },
        { code: 'SI', nameFr: 'Slovénie', nameEn: 'Slovenia', nationalityFr: 'slovène', nationalityEn: 'Slovenian' },
        { code: 'SE', nameFr: 'Suède', nameEn: 'Sweden', nationalityFr: 'suédoise', nationalityEn: 'Swedish' },
        { code: 'CH', nameFr: 'Suisse', nameEn: 'Switzerland', nationalityFr: 'suisse', nationalityEn: 'Swiss' },
        { code: 'CZ', nameFr: 'Tchéquie', nameEn: 'Czechia', nationalityFr: 'tchèque', nationalityEn: 'Czech' },
        { code: 'UA', nameFr: 'Ukraine', nameEn: 'Ukraine', nationalityFr: 'ukrainienne', nationalityEn: 'Ukrainian' },

        { code: 'AF', nameFr: 'Afghanistan', nameEn: 'Afghanistan', nationalityFr: 'afghane', nationalityEn: 'Afghan' },
        { code: 'SA', nameFr: 'Arabie saoudite', nameEn: 'Saudi Arabia', nationalityFr: 'saoudienne', nationalityEn: 'Saudi' },
        { code: 'AM', nameFr: 'Arménie', nameEn: 'Armenia', nationalityFr: 'arménienne', nationalityEn: 'Armenian' },
        { code: 'AZ', nameFr: 'Azerbaïdjan', nameEn: 'Azerbaijan', nationalityFr: 'azerbaïdjanaise', nationalityEn: 'Azerbaijani' },
        { code: 'BH', nameFr: 'Bahreïn', nameEn: 'Bahrain', nationalityFr: 'bahreïnienne', nationalityEn: 'Bahraini' },
        { code: 'BD', nameFr: 'Bangladesh', nameEn: 'Bangladesh', nationalityFr: 'bangladaise', nationalityEn: 'Bangladeshi' },
        { code: 'BT', nameFr: 'Bhoutan', nameEn: 'Bhutan', nationalityFr: 'bhoutanaise', nationalityEn: 'Bhutanese' },
        { code: 'MM', nameFr: 'Birmanie (Myanmar)', nameEn: 'Myanmar', nationalityFr: 'birmane', nationalityEn: 'Burmese' },
        { code: 'BN', nameFr: 'Brunei', nameEn: 'Brunei', nationalityFr: 'brunéienne', nationalityEn: 'Bruneian' },
        { code: 'KH', nameFr: 'Cambodge', nameEn: 'Cambodia', nationalityFr: 'cambodgienne', nationalityEn: 'Cambodian' },
        { code: 'CN', nameFr: 'Chine', nameEn: 'China', nationalityFr: 'chinoise', nationalityEn: 'Chinese' },
        { code: 'KP', nameFr: 'Corée du Nord', nameEn: 'North Korea', nationalityFr: 'nord-coréenne', nationalityEn: 'North Korean' },
        { code: 'KR', nameFr: 'Corée du Sud', nameEn: 'South Korea', nationalityFr: 'sud-coréenne', nationalityEn: 'South Korean' },
        { code: 'AE', nameFr: 'Émirats arabes unis', nameEn: 'United Arab Emirates', nationalityFr: 'émirienne', nationalityEn: 'Emirati' },
        { code: 'GE', nameFr: 'Géorgie', nameEn: 'Georgia', nationalityFr: 'géorgienne', nationalityEn: 'Georgian' },
        { code: 'IN', nameFr: 'Inde', nameEn: 'India', nationalityFr: 'indienne', nationalityEn: 'Indian' },
        { code: 'ID', nameFr: 'Indonésie', nameEn: 'Indonesia', nationalityFr: 'indonésienne', nationalityEn: 'Indonesian' },
        { code: 'IQ', nameFr: 'Irak', nameEn: 'Iraq', nationalityFr: 'irakienne', nationalityEn: 'Iraqi' },
        { code: 'IR', nameFr: 'Iran', nameEn: 'Iran', nationalityFr: 'iranienne', nationalityEn: 'Iranian' },
        { code: 'IL', nameFr: 'Israël', nameEn: 'Israel', nationalityFr: 'israélienne', nationalityEn: 'Israeli' },
        { code: 'JP', nameFr: 'Japon', nameEn: 'Japan', nationalityFr: 'japonaise', nationalityEn: 'Japanese' },
        { code: 'JO', nameFr: 'Jordanie', nameEn: 'Jordan', nationalityFr: 'jordanienne', nationalityEn: 'Jordanian' },
        { code: 'KZ', nameFr: 'Kazakhstan', nameEn: 'Kazakhstan', nationalityFr: 'kazakhe', nationalityEn: 'Kazakh' },
        { code: 'KG', nameFr: 'Kirghizistan', nameEn: 'Kyrgyzstan', nationalityFr: 'kirghize', nationalityEn: 'Kyrgyz' },
        { code: 'KW', nameFr: 'Koweït', nameEn: 'Kuwait', nationalityFr: 'koweïtienne', nationalityEn: 'Kuwaiti' },
        { code: 'LA', nameFr: 'Laos', nameEn: 'Laos', nationalityFr: 'laotienne', nationalityEn: 'Laotian' },
        { code: 'LB', nameFr: 'Liban', nameEn: 'Lebanon', nationalityFr: 'libanaise', nationalityEn: 'Lebanese' },
        { code: 'MY', nameFr: 'Malaisie', nameEn: 'Malaysia', nationalityFr: 'malaisienne', nationalityEn: 'Malaysian' },
        { code: 'MV', nameFr: 'Maldives', nameEn: 'Maldives', nationalityFr: 'maldivienne', nationalityEn: 'Maldivian' },
        { code: 'MN', nameFr: 'Mongolie', nameEn: 'Mongolia', nationalityFr: 'mongole', nationalityEn: 'Mongolian' },
        { code: 'NP', nameFr: 'Népal', nameEn: 'Nepal', nationalityFr: 'népalaise', nationalityEn: 'Nepali' },
        { code: 'OM', nameFr: 'Oman', nameEn: 'Oman', nationalityFr: 'omanaise', nationalityEn: 'Omani' },
        { code: 'UZ', nameFr: 'Ouzbékistan', nameEn: 'Uzbekistan', nationalityFr: 'ouzbèke', nationalityEn: 'Uzbek' },
        { code: 'PK', nameFr: 'Pakistan', nameEn: 'Pakistan', nationalityFr: 'pakistanaise', nationalityEn: 'Pakistani' },
        { code: 'PS', nameFr: 'Palestine', nameEn: 'Palestine', nationalityFr: 'palestinienne', nationalityEn: 'Palestinian' },
        { code: 'PH', nameFr: 'Philippines', nameEn: 'Philippines', nationalityFr: 'philippine', nationalityEn: 'Filipino' },
        { code: 'QA', nameFr: 'Qatar', nameEn: 'Qatar', nationalityFr: 'qatarienne', nationalityEn: 'Qatari' },
        { code: 'SG', nameFr: 'Singapour', nameEn: 'Singapore', nationalityFr: 'singapourienne', nationalityEn: 'Singaporean' },
        { code: 'LK', nameFr: 'Sri Lanka', nameEn: 'Sri Lanka', nationalityFr: 'srilankaise', nationalityEn: 'Sri Lankan' },
        { code: 'SY', nameFr: 'Syrie', nameEn: 'Syria', nationalityFr: 'syrienne', nationalityEn: 'Syrian' },
        { code: 'TJ', nameFr: 'Tadjikistan', nameEn: 'Tajikistan', nationalityFr: 'tadjike', nationalityEn: 'Tajik' },
        { code: 'TW', nameFr: 'Taïwan', nameEn: 'Taiwan', nationalityFr: 'taïwanaise', nationalityEn: 'Taiwanese' },
        { code: 'TH', nameFr: 'Thaïlande', nameEn: 'Thailand', nationalityFr: 'thaïlandaise', nationalityEn: 'Thai' },
        { code: 'TL', nameFr: 'Timor oriental', nameEn: 'Timor-Leste', nationalityFr: 'est-timoraise', nationalityEn: 'Timorese' },
        { code: 'TM', nameFr: 'Turkménistan', nameEn: 'Turkmenistan', nationalityFr: 'turkmène', nationalityEn: 'Turkmen' },
        { code: 'TR', nameFr: 'Turquie', nameEn: 'Türkiye', nationalityFr: 'turque', nationalityEn: 'Turkish' },
        { code: 'VN', nameFr: 'Viêt Nam', nameEn: 'Vietnam', nationalityFr: 'vietnamienne', nationalityEn: 'Vietnamese' },
        { code: 'YE', nameFr: 'Yémen', nameEn: 'Yemen', nationalityFr: 'yéménite', nationalityEn: 'Yemeni' },

        { code: 'AU', nameFr: 'Australie', nameEn: 'Australia', nationalityFr: 'australienne', nationalityEn: 'Australian' },
        { code: 'FJ', nameFr: 'Fidji', nameEn: 'Fiji', nationalityFr: 'fidjienne', nationalityEn: 'Fijian' },
        { code: 'KI', nameFr: 'Kiribati', nameEn: 'Kiribati', nationalityFr: 'kiribatienne', nationalityEn: 'I-Kiribati' },
        { code: 'MH', nameFr: 'Îles Marshall', nameEn: 'Marshall Islands', nationalityFr: 'marshallaise', nationalityEn: 'Marshallese' },
        { code: 'FM', nameFr: 'Micronésie', nameEn: 'Micronesia', nationalityFr: 'micronésienne', nationalityEn: 'Micronesian' },
        { code: 'NR', nameFr: 'Nauru', nameEn: 'Nauru', nationalityFr: 'nauruane', nationalityEn: 'Nauruan' },
        { code: 'NZ', nameFr: 'Nouvelle-Zélande', nameEn: 'New Zealand', nationalityFr: 'néo-zélandaise', nationalityEn: 'New Zealander' },
        { code: 'PW', nameFr: 'Palaos', nameEn: 'Palau', nationalityFr: 'palaosienne', nationalityEn: 'Palauan' },
        { code: 'PG', nameFr: 'Papouasie-Nouvelle-Guinée', nameEn: 'Papua New Guinea', nationalityFr: 'papouane-néo-guinéenne', nationalityEn: 'Papua New Guinean' },
        { code: 'WS', nameFr: 'Samoa', nameEn: 'Samoa', nationalityFr: 'samoane', nationalityEn: 'Samoan' },
        { code: 'SB', nameFr: 'Îles Salomon', nameEn: 'Solomon Islands', nationalityFr: 'salomonienne', nationalityEn: 'Solomon Islander' },
        { code: 'TO', nameFr: 'Tonga', nameEn: 'Tonga', nationalityFr: 'tongienne', nationalityEn: 'Tongan' },
        { code: 'TV', nameFr: 'Tuvalu', nameEn: 'Tuvalu', nationalityFr: 'tuvaluane', nationalityEn: 'Tuvaluan' },
        { code: 'VU', nameFr: 'Vanuatu', nameEn: 'Vanuatu', nationalityFr: 'vanuataise', nationalityEn: 'Ni-Vanuatu' }
    ];

    const BY_CODE = {};
    LIST.forEach(c => { BY_CODE[c.code] = c; });

    function normalize(str) {
        return (str || '').toString().trim().toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    function getAll() {
        return LIST.slice().sort((a, b) => normalize(a.nameFr).localeCompare(normalize(b.nameFr)));
    }

    function getByCode(code) {
        return BY_CODE[code] || null;
    }

    function getCountryName(code, lang = 'fr') {
        const c = BY_CODE[code];
        if (!c) return null;
        return lang === 'en' ? c.nameEn : c.nameFr;
    }

    function getNationality(code, lang = 'fr') {
        const c = BY_CODE[code];
        if (!c) return null;
        return lang === 'en' ? c.nationalityEn : c.nationalityFr;
    }

    function findCodeByText(text) {
        const n = normalize(text);
        if (!n) return null;
        const hit = LIST.find(c =>
            normalize(c.nameFr) === n ||
            normalize(c.nameEn) === n ||
            normalize(c.nationalityFr) === n ||
            normalize(c.nationalityEn) === n
        );
        return hit ? hit.code : null;
    }

    return { getAll, getByCode, getCountryName, getNationality, findCodeByText };
})();
